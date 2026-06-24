using System.Collections.Concurrent;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Storage.Streams;

[assembly: SupportedOSPlatform("windows10.0.19041")]

namespace HypeRate.BleWin;

internal sealed class Program
{
    private static readonly Guid HeartRateServiceUuid = Guid.Parse("0000180d-0000-1000-8000-00805f9b34fb");
    private static readonly Guid HeartRateMeasurementUuid = Guid.Parse("00002a37-0000-1000-8000-00805f9b34fb");
    private static readonly TimeSpan DisconnectDebounceDelay = TimeSpan.FromSeconds(6);
    private static readonly string[] DeviceInformationProperties =
    [
        "System.Devices.Aep.DeviceAddress",
        "System.Devices.Aep.IsConnected",
        "System.ItemNameDisplay",
    ];

    private static readonly object OutputLock = new();
    private static readonly SemaphoreSlim ConnectionLock = new(1, 1);
    private static readonly ConcurrentDictionary<string, DeviceAdvertisement> Devices = new();
    private static readonly HashSet<string> EmittedDevices = new(StringComparer.OrdinalIgnoreCase);

    private static BluetoothLEAdvertisementWatcher? _watcher;
    private static BluetoothLEDevice? _device;
    private static GattSession? _gattSession;
    private static GattDeviceService? _heartRateService;
    private static GattCharacteristic? _heartRateCharacteristic;
    private static bool _manualDisconnect;
    private static bool _subscribed;
    private static bool _connectionReady;
    private static int _connectionEpoch;
    private static string? _connectedName;

    public static async Task Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

        Emit(new StatusEvent("status", "ready"));

        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            Command? command;
            try
            {
                command = JsonSerializer.Deserialize(line, BleJsonContext.Default.Command);
            }
            catch (Exception ex)
            {
                EmitStatus("command-error", reason: ex.Message);
                continue;
            }

            try
            {
                switch ((command?.Cmd ?? string.Empty).Trim().ToLowerInvariant())
                {
                    case "scan-start":
                        await StartScanAsync();
                        break;
                    case "scan-stop":
                        StopScan(silent: false);
                        break;
                    case "connect":
                        await ConnectAsync(command?.Id, command?.Name);
                        break;
                    case "disconnect":
                        await DisconnectAsync(emitStatus: true);
                        break;
                    case "shutdown":
                        await DisconnectAsync(emitStatus: false);
                        StopScan(silent: true);
                        return;
                    default:
                        EmitStatus("command-error", reason: "Unknown command.");
                        break;
                }
            }
            catch (Exception ex)
            {
                EmitStatus("command-error", reason: ex.Message);
            }
        }
    }

    private static async Task StartScanAsync()
    {
        StopScan(silent: true);
        Devices.Clear();
        lock (EmittedDevices) EmittedDevices.Clear();

        BluetoothAdapter? adapter;
        try
        {
            adapter = await BluetoothAdapter.GetDefaultAsync();
        }
        catch (Exception ex)
        {
            EmitStatus("ble-unavailable", reason: ex.Message);
            return;
        }

        if (adapter is null)
        {
            EmitStatus("ble-unavailable", reason: "No Bluetooth adapter found.");
            return;
        }

        _watcher = new BluetoothLEAdvertisementWatcher
        {
            ScanningMode = BluetoothLEScanningMode.Active,
        };
        _watcher.Received += OnAdvertisementReceived;
        _watcher.Stopped += OnWatcherStopped;
        _watcher.Start();

        EmitStatus("scanning");
    }

    private static void StopScan(bool silent)
    {
        var watcher = _watcher;
        if (watcher is null)
        {
            if (!silent) EmitStatus("idle");
            return;
        }

        _watcher = null;
        watcher.Received -= OnAdvertisementReceived;
        watcher.Stopped -= OnWatcherStopped;
        try { watcher.Stop(); } catch { }

        if (!silent) EmitStatus("idle");
    }

    private static void OnAdvertisementReceived(BluetoothLEAdvertisementWatcher sender, BluetoothLEAdvertisementReceivedEventArgs args)
    {
        var id = args.BluetoothAddress.ToString("X12");
        var advertisedName = (args.Advertisement.LocalName ?? string.Empty).Trim();
        var hasHeartRateService = args.Advertisement.ServiceUuids.Any(uuid => uuid == HeartRateServiceUuid);
        var addressType = args.BluetoothAddressType;

        var device = Devices.AddOrUpdate(
            id,
            _ => new DeviceAdvertisement(id, advertisedName, args.RawSignalStrengthInDBm, hasHeartRateService, addressType),
            (_, existing) =>
            {
                if (!string.IsNullOrWhiteSpace(advertisedName)) existing.Name = advertisedName;
                existing.Rssi = args.RawSignalStrengthInDBm;
                existing.HasHeartRateService |= hasHeartRateService;
                existing.AddressType = addressType;
                return existing;
            });

        if (!device.HasHeartRateService && !LooksLikeHeartRateDevice(device.Name)) return;

        lock (EmittedDevices)
        {
            if (!EmittedDevices.Add(id)) return;
        }

        Emit(new DeviceEvent(
            "device",
            id,
            string.IsNullOrWhiteSpace(device.Name) ? "HR Monitor" : device.Name,
            device.Rssi));
    }

    private static void OnWatcherStopped(BluetoothLEAdvertisementWatcher sender, BluetoothLEAdvertisementWatcherStoppedEventArgs args)
    {
        if (_watcher is null) return;
        if (args.Error != BluetoothError.Success)
        {
            EmitStatus("scan-error", reason: args.Error.ToString());
        }
    }

    private static async Task ConnectAsync(string? id, string? requestedName)
    {
        if (string.IsNullOrWhiteSpace(id) || !TryParseBluetoothAddress(id, out var address))
        {
            EmitStatus("connect-error", reason: "Invalid Bluetooth device id.");
            return;
        }

        var normalizedId = NormalizeBluetoothId(id);

        await ConnectionLock.WaitAsync();
        try
        {
            _manualDisconnect = false;
            _connectionReady = false;
            StopScan(silent: true);
            await CloseConnectionAsync();
            await Task.Delay(300);

            _connectedName = CleanName(requestedName);
            EmitStatus("connecting", name: _connectedName);

            _heartRateService = await OpenHeartRateServiceViaDeviceSelectorAsync(address, normalizedId, requestedName);
            if (_heartRateService is not null)
            {
                _device = _heartRateService.Device;
                Emit(new LogEvent("log", "Opened Heart Rate service via Windows GATT service selector."));
            }
            else
            {
                _device = await OpenBluetoothDeviceViaDeviceSelectorAsync(address, normalizedId, requestedName)
                    ?? await OpenBluetoothDeviceAsync(address, normalizedId);
                if (_device is not null)
                {
                    _heartRateService = await GetHeartRateServiceAsync(_device);
                    Emit(new LogEvent("log", "Opened Heart Rate service via Bluetooth address fallback."));
                }
            }

            if (_device is null || _heartRateService is null)
            {
                EmitStatus("connect-error", reason: "Windows could not open the Bluetooth device.");
                return;
            }

            _device.ConnectionStatusChanged += OnConnectionStatusChanged;

            _connectedName = CleanName(_connectedName) ?? CleanName(_device.Name) ?? "HR Monitor";

            _gattSession = await GattSession.FromDeviceIdAsync(_device.BluetoothDeviceId).AsTask().WaitAsync(TimeSpan.FromSeconds(12));
            if (_gattSession is not null)
            {
                _gattSession.MaintainConnection = true;
            }

            await WaitForConnectionAsync(_device, TimeSpan.FromSeconds(10));

            _heartRateCharacteristic = await GetHeartRateCharacteristicAsync(_heartRateService);

            await SubscribeAsync(_heartRateCharacteristic);

            _subscribed = true;
            _connectionReady = true;
            Interlocked.Increment(ref _connectionEpoch);
            Emit(new LogEvent("log", $"Subscribed to heart rate notifications for {_connectedName}."));
            EmitStatus("connected", name: _connectedName);
        }
        catch (TimeoutException)
        {
            await CloseConnectionAsync();
            EmitStatus("connect-error", reason: "Windows BLE timed out while connecting to the heart rate monitor.");
        }
        catch (Exception ex)
        {
            await CloseConnectionAsync();
            EmitStatus("connect-error", reason: ex.Message);
        }
        finally
        {
            ConnectionLock.Release();
        }
    }

    private static async Task DisconnectAsync(bool emitStatus)
    {
        await ConnectionLock.WaitAsync();
        try
        {
            _manualDisconnect = true;
            await CloseConnectionAsync();
            if (emitStatus) EmitStatus("disconnected");
        }
        finally
        {
            ConnectionLock.Release();
        }
    }

    private static async Task CloseConnectionAsync()
    {
        _connectionReady = false;
        Interlocked.Increment(ref _connectionEpoch);

        if (_heartRateCharacteristic is not null)
        {
            _heartRateCharacteristic.ValueChanged -= OnHeartRateValueChanged;
            if (_subscribed)
            {
                try
                {
                    await _heartRateCharacteristic
                        .WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.None)
                        .AsTask()
                        .WaitAsync(TimeSpan.FromSeconds(4));
                }
                catch { }
            }
        }

        _subscribed = false;

        if (_device is not null)
        {
            try { _device.ConnectionStatusChanged -= OnConnectionStatusChanged; } catch { }
        }

        try { _gattSession?.Dispose(); } catch { }
        try { _heartRateService?.Dispose(); } catch { }
        try { _device?.Dispose(); } catch { }

        _gattSession = null;
        _heartRateService = null;
        _heartRateCharacteristic = null;
        _device = null;
    }

    private static async Task<BluetoothLEDevice?> OpenBluetoothDeviceAsync(ulong address, string normalizedId)
    {
        if (Devices.TryGetValue(normalizedId, out var advertisedDevice))
        {
            Emit(new LogEvent("log", $"Opening device {normalizedId} with address type {advertisedDevice.AddressType}."));
            return await BluetoothLEDevice
                .FromBluetoothAddressAsync(address, advertisedDevice.AddressType)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(12));
        }

        Emit(new LogEvent("log", $"Opening device {normalizedId} without cached address type."));
        return await BluetoothLEDevice
            .FromBluetoothAddressAsync(address)
            .AsTask()
            .WaitAsync(TimeSpan.FromSeconds(12));
    }

    private static async Task<BluetoothLEDevice?> OpenBluetoothDeviceViaDeviceSelectorAsync(
        ulong address,
        string normalizedId,
        string? requestedName)
    {
        var selectors = new[]
        {
            ("paired", BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)),
            ("unpaired", BluetoothLEDevice.GetDeviceSelectorFromPairingState(false)),
        };

        foreach (var (label, selector) in selectors)
        {
            try
            {
                var devices = await DeviceInformation
                    .FindAllAsync(selector, DeviceInformationProperties)
                    .AsTask()
                    .WaitAsync(TimeSpan.FromSeconds(12));

                Emit(new LogEvent("log", $"Windows BLE device selector ({label}) found {devices.Count} candidate(s)."));

                DeviceInformation? selected = null;
                foreach (var deviceInfo in devices)
                {
                    var deviceAddress = GetPropertyString(deviceInfo.Properties, "System.Devices.Aep.DeviceAddress");
                    var normalizedDeviceAddress = string.IsNullOrWhiteSpace(deviceAddress)
                        ? FindBluetoothAddressInDeviceId(deviceInfo.Id, normalizedId)
                        : NormalizeBluetoothId(deviceAddress);
                    var isConnected = GetPropertyString(deviceInfo.Properties, "System.Devices.Aep.IsConnected");
                    var displayName = CleanName(deviceInfo.Name)
                        ?? CleanName(GetPropertyString(deviceInfo.Properties, "System.ItemNameDisplay"))
                        ?? "Unknown";

                    if (normalizedDeviceAddress == normalizedId)
                    {
                        selected = deviceInfo;
                        Emit(new LogEvent(
                            "log",
                            $"Selected BLE device ({label}): name={displayName}, address={normalizedDeviceAddress}, paired={deviceInfo.Pairing.IsPaired}, connected={isConnected ?? "unknown"}."));
                        break;
                    }
                }

                selected ??= SelectServiceByName(devices, requestedName);
                if (selected is null) continue;

                var device = await BluetoothLEDevice
                    .FromIdAsync(selected.Id)
                    .AsTask()
                    .WaitAsync(TimeSpan.FromSeconds(12));

                if (device is not null)
                {
                    Emit(new LogEvent("log", $"Opened BLE device via Windows {label} device selector."));
                    return device;
                }

                Emit(new LogEvent("log", $"Windows {label} device selector returned a matching device, but FromIdAsync returned null."));
            }
            catch (Exception ex)
            {
                Emit(new LogEvent("log", $"Windows {label} device selector failed: {ex.Message}"));
            }
        }

        return null;
    }

    private static async Task<GattDeviceService?> OpenHeartRateServiceViaDeviceSelectorAsync(
        ulong address,
        string normalizedId,
        string? requestedName)
    {
        try
        {
            var selector = GattDeviceService.GetDeviceSelectorFromUuid(HeartRateServiceUuid);
            var services = await DeviceInformation
                .FindAllAsync(selector, DeviceInformationProperties)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(15));

            Emit(new LogEvent("log", $"Windows GATT service selector found {services.Count} Heart Rate service candidate(s)."));

            DeviceInformation? selected = null;
            foreach (var serviceInfo in services)
            {
                var serviceAddress = GetPropertyString(serviceInfo.Properties, "System.Devices.Aep.DeviceAddress");
                var normalizedServiceAddress = string.IsNullOrWhiteSpace(serviceAddress)
                    ? FindBluetoothAddressInDeviceId(serviceInfo.Id, normalizedId)
                    : NormalizeBluetoothId(serviceAddress);
                var isConnected = GetPropertyString(serviceInfo.Properties, "System.Devices.Aep.IsConnected");
                var displayName = CleanName(serviceInfo.Name)
                    ?? CleanName(GetPropertyString(serviceInfo.Properties, "System.ItemNameDisplay"))
                    ?? "Unknown";

                Emit(new LogEvent(
                    "log",
                    $"Service candidate: name={displayName}, address={normalizedServiceAddress ?? "unknown"}, connected={isConnected ?? "unknown"}."));

                if (normalizedServiceAddress == normalizedId)
                {
                    selected = serviceInfo;
                    break;
                }
            }

            selected ??= SelectServiceByName(services, requestedName);
            if (selected is null && services.Count == 1)
            {
                selected = services[0];
                Emit(new LogEvent("log", "Using the only Heart Rate service candidate."));
            }

            if (selected is null)
            {
                Emit(new LogEvent("log", $"No matching Heart Rate service candidate for address {normalizedId}; falling back to Bluetooth address."));
                return null;
            }

            return await GattDeviceService
                .FromIdAsync(selected.Id)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(15));
        }
        catch (Exception ex)
        {
            Emit(new LogEvent("log", $"GATT service selector failed: {ex.Message}"));
            return null;
        }
    }

    private static async Task<GattDeviceService> GetHeartRateServiceAsync(BluetoothLEDevice device)
    {
        var attempts = new[]
        {
            BluetoothCacheMode.Uncached,
            BluetoothCacheMode.Cached,
            BluetoothCacheMode.Uncached,
        };

        string? lastStatus = null;
        foreach (var cacheMode in attempts)
        {
            var result = await device
                .GetGattServicesForUuidAsync(HeartRateServiceUuid, cacheMode)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(12));

            if (result.Status == GattCommunicationStatus.Success && result.Services.Count > 0)
            {
                return result.Services[0];
            }

            lastStatus = DescribeGattStatus(result.Status, result.ProtocolError);
            await Task.Delay(750);
        }

        throw new InvalidOperationException($"Heart Rate service not available ({lastStatus ?? "unknown status"}).");
    }

    private static async Task<GattCharacteristic> GetHeartRateCharacteristicAsync(GattDeviceService service)
    {
        var attempts = new[]
        {
            BluetoothCacheMode.Uncached,
            BluetoothCacheMode.Cached,
        };

        string? lastStatus = null;
        foreach (var cacheMode in attempts)
        {
            var result = await service
                .GetCharacteristicsForUuidAsync(HeartRateMeasurementUuid, cacheMode)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(12));

            if (result.Status == GattCommunicationStatus.Success && result.Characteristics.Count > 0)
            {
                return result.Characteristics[0];
            }

            lastStatus = DescribeGattStatus(result.Status, result.ProtocolError);
            await Task.Delay(500);
        }

        throw new InvalidOperationException($"Heart Rate Measurement characteristic not available ({lastStatus ?? "unknown status"}).");
    }

    private static async Task SubscribeAsync(GattCharacteristic characteristic)
    {
        var properties = characteristic.CharacteristicProperties;
        GattClientCharacteristicConfigurationDescriptorValue descriptorValue;

        if (properties.HasFlag(GattCharacteristicProperties.Notify))
        {
            descriptorValue = GattClientCharacteristicConfigurationDescriptorValue.Notify;
        }
        else if (properties.HasFlag(GattCharacteristicProperties.Indicate))
        {
            descriptorValue = GattClientCharacteristicConfigurationDescriptorValue.Indicate;
        }
        else
        {
            throw new InvalidOperationException("Heart Rate Measurement does not support notifications.");
        }

        characteristic.ValueChanged += OnHeartRateValueChanged;

        GattCommunicationStatus status = GattCommunicationStatus.Unreachable;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            status = await characteristic
                .WriteClientCharacteristicConfigurationDescriptorAsync(descriptorValue)
                .AsTask()
                .WaitAsync(TimeSpan.FromSeconds(12));

            if (status == GattCommunicationStatus.Success) return;

            Emit(new LogEvent("log", $"Subscribe attempt {attempt} failed with {status}."));
            await Task.Delay(700 * attempt);
        }

        characteristic.ValueChanged -= OnHeartRateValueChanged;
        throw new InvalidOperationException($"Could not subscribe to heart rate notifications ({status}).");
    }

    private static async Task WaitForConnectionAsync(BluetoothLEDevice device, TimeSpan timeout)
    {
        if (device.ConnectionStatus == BluetoothConnectionStatus.Connected)
        {
            Emit(new LogEvent("log", "Windows reports Bluetooth device is connected before subscribe."));
            return;
        }

        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        void Handler(BluetoothLEDevice sender, object args)
        {
            if (sender.ConnectionStatus == BluetoothConnectionStatus.Connected)
            {
                tcs.TrySetResult();
            }
        }

        device.ConnectionStatusChanged += Handler;
        try
        {
            var completed = await Task.WhenAny(tcs.Task, Task.Delay(timeout));
            if (completed == tcs.Task)
            {
                Emit(new LogEvent("log", "Windows reports Bluetooth device is connected."));
            }
            else
            {
                Emit(new LogEvent("log", "Timed out waiting for Windows to report Bluetooth connection; trying subscribe anyway."));
            }
        }
        finally
        {
            device.ConnectionStatusChanged -= Handler;
        }
    }

    private static void OnHeartRateValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            var reader = DataReader.FromBuffer(args.CharacteristicValue);
            var data = new byte[args.CharacteristicValue.Length];
            reader.ReadBytes(data);

            if (data.Length < 2) return;

            var is16Bit = (data[0] & 0x01) != 0;
            if (is16Bit && data.Length < 3) return;

            var bpm = is16Bit ? BitConverter.ToUInt16(data, 1) : data[1];
            if (bpm > 0 && bpm < 300)
            {
                if (_connectionReady)
                {
                    Interlocked.Increment(ref _connectionEpoch);
                }
                Emit(new BpmEvent("bpm", bpm));
            }
        }
        catch (Exception ex)
        {
            Emit(new LogEvent("log", $"Could not parse heart rate packet: {ex.Message}"));
        }
    }

    private static void OnConnectionStatusChanged(BluetoothLEDevice sender, object args)
    {
        if (sender.ConnectionStatus != BluetoothConnectionStatus.Disconnected || _manualDisconnect) return;
        if (!ReferenceEquals(_device, sender)) return;

        var epoch = Volatile.Read(ref _connectionEpoch);
        Emit(new LogEvent("log", "Windows reported a disconnect; waiting to confirm it is not transient."));
        _ = Task.Run(() => ConfirmDisconnectAsync(sender, epoch));
    }

    private static async Task ConfirmDisconnectAsync(BluetoothLEDevice sender, int epoch)
    {
        await Task.Delay(DisconnectDebounceDelay);

        if (_manualDisconnect || epoch != Volatile.Read(ref _connectionEpoch)) return;

        await ConnectionLock.WaitAsync();
        try
        {
            if (_manualDisconnect
                || epoch != Volatile.Read(ref _connectionEpoch)
                || !_connectionReady
                || !ReferenceEquals(_device, sender))
            {
                return;
            }

            if (sender.ConnectionStatus != BluetoothConnectionStatus.Disconnected)
            {
                Emit(new LogEvent("log", "Ignored transient Windows disconnect because the device is connected again."));
                return;
            }

            await CloseConnectionAsync();
        }
        finally
        {
            ConnectionLock.Release();
        }

        EmitStatus("disconnected", reason: "Device disconnected.");
    }

    private static bool TryParseBluetoothAddress(string id, out ulong address)
    {
        var trimmed = NormalizeBluetoothId(id);
        if (ulong.TryParse(trimmed, System.Globalization.NumberStyles.HexNumber, null, out address)) return true;
        return ulong.TryParse(id.Trim(), out address);
    }

    private static string NormalizeBluetoothId(string id)
    {
        return id.Trim().Replace(":", string.Empty).Replace("-", string.Empty).ToUpperInvariant();
    }

    private static DeviceInformation? SelectServiceByName(
        IReadOnlyList<DeviceInformation> services,
        string? requestedName)
    {
        var cleanRequestedName = CleanName(requestedName);
        if (cleanRequestedName is null) return null;

        return services.FirstOrDefault(serviceInfo =>
        {
            var displayName = CleanName(serviceInfo.Name)
                ?? CleanName(GetPropertyString(serviceInfo.Properties, "System.ItemNameDisplay"));
            return displayName is not null
                && displayName.Contains(cleanRequestedName, StringComparison.OrdinalIgnoreCase);
        });
    }

    private static string? GetPropertyString(
        IReadOnlyDictionary<string, object> properties,
        string name)
    {
        return properties.TryGetValue(name, out var value) ? value?.ToString() : null;
    }

    private static string? FindBluetoothAddressInDeviceId(string deviceId, string normalizedId)
    {
        return NormalizeBluetoothId(deviceId).Contains(normalizedId, StringComparison.OrdinalIgnoreCase)
            ? normalizedId
            : null;
    }

    private static bool LooksLikeHeartRateDevice(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;

        var lower = name.ToLowerInvariant();
        return lower.Contains("polar")
            || lower.Contains("h10")
            || lower.Contains("h9")
            || lower.Contains("h7")
            || lower.Contains("verity")
            || lower.Contains("oh1")
            || lower.Contains("heart")
            || lower.Contains("hrm")
            || lower.Contains("wahoo")
            || lower.Contains("tickr")
            || lower.Contains("garmin")
            || lower.Contains("coospo");
    }

    private static string? CleanName(string? name)
    {
        var trimmed = name?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
    }

    private static string DescribeGattStatus(GattCommunicationStatus status, byte? protocolError)
    {
        return protocolError is null ? status.ToString() : $"{status}, protocol error 0x{protocolError.Value:X2}";
    }

    private static void EmitStatus(string state, string? reason = null, string? name = null)
    {
        Emit(new StatusEvent("status", state, reason, name));
    }

    private static void Emit(StatusEvent payload) => EmitJson(payload, BleJsonContext.Default.StatusEvent);
    private static void Emit(DeviceEvent payload) => EmitJson(payload, BleJsonContext.Default.DeviceEvent);
    private static void Emit(BpmEvent payload) => EmitJson(payload, BleJsonContext.Default.BpmEvent);
    private static void Emit(LogEvent payload) => EmitJson(payload, BleJsonContext.Default.LogEvent);

    private static void EmitJson<T>(T payload, JsonTypeInfo<T> typeInfo)
    {
        lock (OutputLock)
        {
            Console.WriteLine(JsonSerializer.Serialize(payload, typeInfo));
            Console.Out.Flush();
        }
    }

    private sealed class DeviceAdvertisement(string id, string? name, short rssi, bool hasHeartRateService, BluetoothAddressType addressType)
    {
        public string Id { get; } = id;
        public string? Name { get; set; } = CleanName(name);
        public short Rssi { get; set; } = rssi;
        public bool HasHeartRateService { get; set; } = hasHeartRateService;
        public BluetoothAddressType AddressType { get; set; } = addressType;
    }
}

internal sealed class Command
{
    public string? Cmd { get; init; }
    public string? Id { get; init; }
    public string? Name { get; init; }
}

internal sealed record StatusEvent(string Type, string State, string? Reason = null, string? Name = null);
internal sealed record DeviceEvent(string Type, string Id, string Name, short Rssi);
internal sealed record BpmEvent(string Type, int Bpm);
internal sealed record LogEvent(string Type, string Message);

[JsonSourceGenerationOptions(
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(Command))]
[JsonSerializable(typeof(StatusEvent))]
[JsonSerializable(typeof(DeviceEvent))]
[JsonSerializable(typeof(BpmEvent))]
[JsonSerializable(typeof(LogEvent))]
internal partial class BleJsonContext : JsonSerializerContext
{
}
