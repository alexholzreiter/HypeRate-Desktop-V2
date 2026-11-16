local _, addon = ...

-- Public, read-only-by-convention interface. Never expose the mutable peer store.
local API = {
    version = 1, addonVersion = addon.version,
    localTimeout = addon.localTimeout, remoteTimeout = addon.remoteTimeout,
}
_G.HypeRaidAPI = API
-- Compatibility for unitframe integrations written against API v1.
_G.HypeRatePartyAPI = API

local listeners, previous, localConsumers = {}, {}, {}
local notifying = false

local function plainString(value)
    if issecretvalue and issecretvalue(value) then return end
    return type(value) == "string" and value ~= ""
end

local function resolveGUID(unit)
    if not plainString(unit) then return end
    local ok, guid = pcall(UnitGUID, unit)
    if ok and plainString(guid) then return guid end
end

function API.GetSampleByGUID(guid, includeTest)
    if not plainString(guid) then return end
    if issecretvalue and issecretvalue(includeTest) then return end
    return addon.getHeartRateRecord(guid, includeTest == true)
end

function API.GetSample(unit, includeTest)
    local guid = resolveGUID(unit)
    if guid then return API.GetSampleByGUID(guid, includeTest) end
end

function API.GetBPM(unit, includeTest)
    local sample = API.GetSample(unit, includeTest)
    return sample and sample.bpm
end

function API.GetBPMByGUID(guid, includeTest)
    local sample = API.GetSampleByGUID(guid, includeTest)
    return sample and sample.bpm
end

function API.GetSamples(includeTest)
    local result = {}
    for _, guid in ipairs(addon.getHeartRateGUIDs()) do
        local sample = API.GetSampleByGUID(guid, includeTest)
        if sample then result[#result + 1] = sample end
    end
    return result
end

-- This starts only the existing local reader; it never opts into group sharing.
function API.AcquireLocalFeed(owner)
    if owner == nil then return end
    localConsumers[owner] = true
    addon.syncFontReader()
end

function API.ReleaseLocalFeed(owner)
    if owner == nil then return end
    localConsumers[owner] = nil
    addon.syncFontReader()
end

function addon.hasUnitFrameConsumer()
    return next(localConsumers) ~= nil
end

function API.RegisterCallback(owner, callback)
    assert(owner ~= nil and type(callback) == "function", "HypeRaidAPI: owner and callback required")
    listeners[owner] = callback
end

function API.UnregisterCallback(owner)
    if owner ~= nil then listeners[owner] = nil end
    if not next(listeners) then previous = {} end
end

function addon.notifyHeartRateChanged()
    if notifying or not next(listeners) then return end
    notifying = true
    local current, changed, callbacks = {}, {}, {}
    for _, sample in ipairs(API.GetSamples(true)) do
        local signature = table.concat({ tostring(sample.bpm), tostring(sample.receivedAt),
            tostring(sample.sourceTimestamp), tostring(sample.isTest), sample.source }, ":")
        current[sample.guid] = signature
        if previous[sample.guid] ~= signature then changed[#changed + 1] = sample.guid end
    end
    for guid in pairs(previous) do
        if not current[guid] then changed[#changed + 1] = guid end
    end
    previous = current
    for owner, callback in pairs(listeners) do
        callbacks[#callbacks + 1] = { owner, callback }
    end
    for _, guid in ipairs(changed) do
        for _, entry in ipairs(callbacks) do
            if listeners[entry[1]] == entry[2] then
                local ok, err = pcall(entry[2], entry[1], "HYPERATE_UPDATE", guid)
                if not ok and geterrorhandler then pcall(geterrorhandler(), err) end
            end
        end
    end
    notifying = false
end

-- Expiry must notify consumers even when the group meter is hidden.
C_Timer.NewTicker(1, addon.notifyHeartRateChanged)
