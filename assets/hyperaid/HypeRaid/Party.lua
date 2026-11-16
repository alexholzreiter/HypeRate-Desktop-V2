local _, addon = ...
addon.title = "HypeRaid"
addon.version = "0.4.1"
-- Keep the message prefix for players using older versions of the addon.
local PREFIX = "HypeRateParty"
local SEND_INTERVAL = 7.5
local LOCAL_TIMEOUT, SAMPLE_TIMEOUT = 25, 30
addon.localTimeout, addon.remoteTimeout = LOCAL_TIMEOUT, SAMPLE_TIMEOUT
local CHART_SECONDS, CHART_POINTS = 60, 24
addon.chartSeconds = CHART_SECONDS
local MIN_BPM, MAX_BPM = 30, 240
local peers, roster = {}, {}
local guidToName = {}
local channel
local playerKey, playerClass, playerGUID, localSample
local localHistory = {}
local sharing, hasSent = false, false
local nextSend = 0
local sendStatus
local fontStatus
local registration, lastTestSend, lastTestReceive
local nextTest = 0

local function isSecret(value)
    return issecretvalue and issecretvalue(value)
end

local function currentChannel()
    if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
        return "INSTANCE_CHAT", LE_PARTY_CATEGORY_INSTANCE
    end
    if IsInRaid() then
        return "RAID"
    end
    if IsInGroup() then
        return "PARTY"
    end
end

local function characterName(value)
    if isSecret(value) or type(value) ~= "string" then
        return
    end
    local name = value:match("^%s*(.-)%s*$"):gsub("%s+", " ")
    if name ~= "" then
        return name
    end
end

local function unitCharacterName(unit)
    -- Forever's GetUnitName returns the same first-name/surname format as addon chat.
    local name = characterName(GetUnitName(unit, false))
    if name and name:find(" ", 1, true) then
        return name
    end

    -- On Forever, the second value of UnitFullName is the surname.
    local first, last = UnitFullName(unit)
    first, last = characterName(first), characterName(last)
    if first and last and not first:find(" ", 1, true) then
        return first .. " " .. last
    end
    return first or name
end

local function unitClass(unit)
    local ok, _, class = pcall(UnitClass, unit)
    if ok and not isSecret(class) and type(class) == "string" then
        return class
    end
end

local function unitGUID(unit)
    local ok, guid = pcall(UnitGUID, unit)
    if ok and not isSecret(guid) and type(guid) == "string" and guid ~= "" then
        return guid
    end
end

function addon.getLocalBpm()
    if localSample then
        local age = time() - localSample.timestamp
        if age >= 0 and age < LOCAL_TIMEOUT then
            return localSample.bpm
        end
    end
end

-- Return a detached snapshot for the public API, never the peer or history table.
function addon.getHeartRateRecord(guid, includeTest)
    local now = GetTime()
    if guid == playerGUID then
        local bpm = addon.getLocalBpm()
        if not bpm then return end
        local age = time() - localSample.timestamp
        return { guid = guid, name = playerKey, bpm = bpm, source = "local",
            isTest = false, receivedAt = localSample.receivedAt, sourceTimestamp = localSample.timestamp,
            ageSeconds = age, expiresAt = now + LOCAL_TIMEOUT - age }
    end

    local name = guidToName[guid]
    local sample = name and peers[name]
    if not sample or sample.guid ~= guid or unitGUID(roster[name].unit) ~= guid then return end
    local age = now - sample.receivedAt
    if age < 0 or age >= SAMPLE_TIMEOUT or (sample.test and not includeTest) then return end
    return { guid = guid, name = name, bpm = sample.bpm, source = "group",
        isTest = sample.test == true, receivedAt = sample.receivedAt,
        ageSeconds = age, expiresAt = sample.receivedAt + SAMPLE_TIMEOUT, distribution = channel }
end

function addon.getHeartRateGUIDs()
    local result = {}
    if playerGUID then result[#result + 1] = playerGUID end
    for guid in pairs(guidToName) do result[#result + 1] = guid end
    return result
end

function addon.getSharedBpm(unit)
    if not channel or isSecret(unit) or type(unit) ~= "string" then
        return
    end
    local key = unitCharacterName(unit)
    local member = key and roster[key]
    local sample = member and peers[key]
    if not sample or sample.test or GetTime() - sample.receivedAt >= SAMPLE_TIMEOUT then
        return
    end
    if unit ~= member.unit then
        local sameUnit = UnitIsUnit(unit, member.unit)
        if isSecret(sameUnit) or not sameUnit then
            return
        end
    end
    return sample.bpm
end

local function recordPulse(history, bpm, now)
    local last = history[#history]
    if last and now - last.time >= SAMPLE_TIMEOUT then
        wipe(history)
        last = nil
    end
    if last and last.time == now then
        last.bpm = bpm
        return
    end
    while history[1] and (now - history[1].time > CHART_SECONDS or #history >= CHART_POINTS) do
        table.remove(history, 1)
    end
    history[#history + 1] = { bpm = bpm, time = now }
end

function addon.getPartyRows()
    local now, rows = GetTime(), {}
    for name, sample in pairs(peers) do
        if now - sample.receivedAt >= SAMPLE_TIMEOUT then
            peers[name] = nil
        else
            rows[#rows + 1] = {
                name = name, class = roster[name].class, bpm = sample.bpm, test = sample.test, history = sample.history,
            }
        end
    end
    local bpm = sharing and hasSent and addon.getLocalBpm()
    if bpm and playerKey then
        rows[#rows + 1] = { name = playerKey, class = playerClass, bpm = bpm, history = localHistory }
    end
    return rows
end

function addon.getGroupState()
    local status = sendStatus or "Your BPM is private"
    if sharing and not sendStatus then
        status = channel and "Sharing with your group" or "Will share when you join a group"
    end
    return channel ~= nil, sharing, GetTime() >= nextTest, status, fontStatus
end

function addon.syncFontReader()
    if addon.setFontReading then
        addon.setFontReading((sharing and channel ~= nil) or addon.isPortraitEnabled()
            or (addon.hasUnitFrameConsumer and addon.hasUnitFrameConsumer()))
    end
end

local function render()
    addon.refreshUI()
    if addon.notifyHeartRateChanged then addon.notifyHeartRateChanged() end
end

function addon.setFontStatus(text)
    fontStatus = text
    render()
end

local function updateRoster()
    local newChannel, category = currentChannel()
    if newChannel ~= channel then
        -- An explicit solo opt-in applies to the first group joined.
        if channel then sharing = false end
        channel = newChannel
        hasSent, sendStatus, nextSend = false, nil, 0
        wipe(peers)
        wipe(localHistory)
    end
    wipe(roster)
    wipe(guidToName)
    playerKey = unitCharacterName("player")
    playerClass = unitClass("player")
    local currentPlayerGUID = unitGUID("player")
    if playerGUID and currentPlayerGUID and playerGUID ~= currentPlayerGUID then
        localSample = nil
        wipe(localHistory)
    end
    playerGUID = currentPlayerGUID
    if not channel then
        return
    end

    local raid = IsInRaid(category)
    local count = raid and GetNumGroupMembers(category) or GetNumSubgroupMembers(category)
    for index = 1, count do
        local unit = (raid and "raid" or "party") .. index
        local key = unitCharacterName(unit)
        if key and key ~= playerKey then
            local guid = unitGUID(unit)
            roster[key] = { unit = unit, class = unitClass(unit), guid = guid }
            if guid then guidToName[guid] = key end
        end
    end
    for name, sample in pairs(peers) do
        local member = roster[name]
        if not member or (member.guid and sample.guid ~= member.guid) then
            peers[name] = nil
        end
    end
end

local function send(message)
    local ok, result = pcall(C_ChatInfo.SendAddonMessage, PREFIX, message, channel)
    if not ok then
        return false, "Lua error: " .. tostring(result)
    end
    return result == 0 or result == true, tostring(result)
end

-- Local input from the experimental bridge addon. Sharing requires a separate click.
function HypeRaid_PublishBpm(bpm, timestamp)
    if isSecret(bpm) or isSecret(timestamp) then return end
    local age = type(timestamp) == "number" and time() - timestamp
    if type(bpm) ~= "number" or bpm < MIN_BPM or bpm > MAX_BPM or bpm % 1 ~= 0
        or not age or age ~= age or age < 0 or age >= LOCAL_TIMEOUT
        or (localSample and timestamp < localSample.timestamp) then
        return
    end
    localSample = { bpm = bpm, timestamp = timestamp, receivedAt = GetTime() }
    if not sharing or not channel or currentChannel() ~= channel or GetTime() < nextSend then
        render()
        return
    end
    nextSend = GetTime() + SEND_INTERVAL
    if send(("1:%d"):format(bpm)) then
        hasSent = true
        sendStatus = nil
        recordPulse(localHistory, bpm, GetTime())
    else
        sendStatus = "WoW blocked sending. Retrying on a new sample."
    end
    render()
end

_G.HypeRateParty_PublishBpm = HypeRaid_PublishBpm

local function publishInitialSample()
    if channel and sharing and not hasSent and addon.getLocalBpm() then
        HypeRaid_PublishBpm(localSample.bpm, localSample.timestamp)
    end
end

function addon.setSharing(enabled)
    enabled = enabled and true or false
    updateRoster()
    if sharing == enabled then
        addon.syncFontReader()
        render()
        return
    end
    sharing = enabled
    sendStatus = nil
    if not sharing and hasSent then
        send("1:off")
        hasSent = false
        wipe(localHistory)
    end
    addon.syncFontReader()
    publishInitialSample()
    render()
end

function addon.sendTest()
    updateRoster()
    if not channel or GetTime() < nextTest then
        return
    end
    nextTest = GetTime() + SEND_INTERVAL
    local queued, code = send("1:test")
    lastTestSend = ("%s %s (result %s)"):format(channel, queued and "queued" or "rejected", code)
    print(addon.title .. ": Test " .. lastTestSend)
    render()
end

local listener = CreateFrame("Frame")
listener:RegisterEvent("PLAYER_ENTERING_WORLD")
listener:RegisterEvent("GROUP_ROSTER_UPDATE")
listener:RegisterEvent("PLAYER_TARGET_CHANGED")
listener:RegisterEvent("CHAT_MSG_ADDON")
listener:SetScript("OnEvent", function(_, event, prefix, message, distribution, sender)
    if event == "PLAYER_TARGET_CHANGED" then
        render()
        return
    elseif event ~= "CHAT_MSG_ADDON" then
        if event == "PLAYER_ENTERING_WORLD" then
            registration = C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
            addon.initializeUI()
        end
        updateRoster()
        addon.syncFontReader()
        publishInitialSample()
        render()
        return
    end

    if isSecret(prefix) or isSecret(message) or isSecret(distribution) or isSecret(sender)
        or prefix ~= PREFIX or type(message) ~= "string" or type(sender) ~= "string" then
        return
    end
    local isTest = message == "1:test"
    if not channel or distribution ~= channel then
        if isTest then
            lastTestReceive = ("channel mismatch (%s, expected %s)"):format(tostring(distribution), tostring(channel))
            print(addon.title .. ": Test received, " .. lastTestReceive)
        end
        return
    end
    local key = characterName(sender)
    if key and key == playerKey then
        return
    end
    if not key or not roster[key] then
        if isTest then
            lastTestReceive = "sender not matched to group: " .. sender
            print(addon.title .. ": Test received, " .. lastTestReceive)
        end
        return
    end
    if message == "1:off" then
        peers[key] = nil
    else
        local bpm = isTest and 92 or tonumber(message:match("^1:(%d%d%d?)$"))
        if not bpm or bpm < MIN_BPM or bpm > MAX_BPM then
            return
        end
        local now = GetTime()
        local guid = roster[key].guid
        local previous = peers[key]
        if previous and previous.guid ~= guid then previous = nil end
        local history = previous and previous.history or {}
        if not isTest then
            recordPulse(history, bpm, now)
        end
        peers[key] = { bpm = bpm, receivedAt = now, test = isTest, history = history, guid = guid }
        if isTest then
            lastTestReceive = ("%s from %s"):format(channel, key)
            print(addon.title .. ": Test received via " .. lastTestReceive)
        end
    end
    render()
end)

SLASH_HYPERAID1 = "/hyperaid"
SLASH_HYPERAID2 = "/hrparty"
SlashCmdList.HYPERAID = function(input)
    if input:match("^%s*status%s*$") then
        local restricted = C_ChatInfo.AreOutgoingAddonChatMessagesRestricted
        local lockdown = C_ChatInfo.InChatMessagingLockdown
        print(("%s: v%s, group %s, prefix result %s, outgoing restriction %s, lockdown %s.")
            :format(addon.title, addon.version, channel or "none", tostring(registration), restricted and tostring(restricted()) or "unknown",
                lockdown and tostring(lockdown()) or "unknown"))
        print(("%s: Last test sent: %s | received: %s.")
            :format(addon.title, lastTestSend or "none", lastTestReceive or "none"))
        if fontStatus then
            print(addon.title .. ": " .. fontStatus)
        end
        if addon.getUnitFrameStatus then print(addon.title .. ": " .. addon.getUnitFrameStatus()) end
        return
    end
    addon.toggleSettings()
end
