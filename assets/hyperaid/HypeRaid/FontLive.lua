local _, addon = ...
local fontFolder = "HypeRaid"
local SLOT_COUNT, INTERVAL = addon.fontBankSize, addon.fontInterval
local fontFolders = {}
if SLOT_COUNT > 0 then
    fontFolders[1] = fontFolder
end
-- The companion is provisioned by the sender and survives updates to HypeRaid.
local ok, protocol = pcall(C_AddOns.GetAddOnMetadata, "HypeRaidData", "X-HypeRaid-Data")
if ok and protocol == "1" then
    fontFolder = "HypeRaidData"
    SLOT_COUNT, INTERVAL = 4096, 8
    table.insert(fontFolders, 1, fontFolder)
end
if SLOT_COUNT == 0 then
    return
end

local FONT_PATH = "Interface\\AddOns\\%s\\LiveFonts\\Live%04d.ttf"
local LOAD_DELAY = 2
local MAX_SAMPLE_AGE = 25
local RESET_AFTER_ATTEMPTS = 3
local MAX_ATTEMPTS = 10
local measurement = CreateFrame("Frame", nil, UIParent)

local function createMeter()
    local fontString = measurement:CreateFontString(nil, "OVERLAY")
    fontString:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 26, -320)
    fontString:SetAlpha(0)
    fontString:SetWordWrap(false)
    fontString:SetNonSpaceWrap(false)
    return fontString
end

local meter, spareMeter = createMeter(), nil

local function resetMeter()
    local previousMeter = meter
    meter = spareMeter or createMeter()
    spareMeter = previousMeter
    -- Clear the failed font from the measurement before reusing it on a later retry.
    pcall(function()
        previousMeter:SetFont(STANDARD_TEXT_FONT, 64, "")
        previousMeter:SetText("")
    end)
end

local used, usedCount = {}, 0
local ticker, lastBucket, pendingSlot, attempts, resetAttempted
local reading = false
local lastSample = 0
local lastBpm, displayedStatus
local waiting = "Waiting for HypeRate Desktop."
local sourceDetail = waiting
local lastAttemptSlot

function addon.getFontReaderStatus()
    local lastAccepted = lastSample > 0 and ("%d (%ds ago)"):format(lastSample, time() - lastSample) or "none"
    return ("Reader %s (%s), last attempted slot %s, last accepted timestamp %s."):format(
        ticker and "active" or "stopped", fontFolder, tostring(lastAttemptSlot or "none"), lastAccepted)
end

local function showStatus(text)
    if text ~= displayedStatus then
        displayedStatus = text
        addon.setFontStatus(text)
    end
end

local function updateStatus(now)
    local age = now - lastSample
    if lastBpm and age >= 0 and age < MAX_SAMPLE_AGE then
        if age > INTERVAL + 5 then
            showStatus(("Last pulse: %d BPM (%ds ago)"):format(lastBpm, age))
        else
            showStatus(("Live pulse: %d BPM"):format(lastBpm))
        end
    else
        showStatus(sourceDetail)
    end
end

local function readNumber(digits, first, last)
    local value = 0
    for index = first, last do
        value = value * 10 + digits[index]
    end
    return value
end

local function decode(slot, folder)
    local path = FONT_PATH:format(folder, slot)
    local assigned = meter:SetFont(path, 64, "")
    -- WoW may assign the font only when a text layout is requested.
    local ready = pcall(function()
        meter:SetText("A~")
        meter:GetStringWidth()
    end)
    local current = meter:GetFont()
    local matches = type(current) == "string" and current:gsub("/", "\\"):lower() == path:lower()
    if not ready then
        return nil, "Font layout unavailable", true
    end
    if not assigned and not matches then
        return nil, "Font assignment pending", true
    end
    local digits, detail = addon.readFontDigits(meter, 15)
    if not digits then
        return nil, detail
    end

    local bpm = readNumber(digits, 1, 3)
    local timestamp = readNumber(digits, 4, 13)
    local checksum = readNumber(digits, 14, 15)
    if (3 * slot + 7 * bpm + 11 * timestamp) % 97 ~= checksum then
        return nil, "Font checksum mismatch"
    end
    return bpm, timestamp
end

local function readSlot(slot, now)
    local newestBpm, newestTimestamp, newestFolder
    local detail, assignmentFailed
    for _, folder in ipairs(fontFolders) do
        local ok, bpm, timestamp, failed = pcall(decode, slot, folder)
        if ok and bpm and bpm >= 30 and bpm <= 240 and timestamp <= now
            and now - timestamp < MAX_SAMPLE_AGE then
            if not newestTimestamp or timestamp > newestTimestamp then
                newestBpm, newestTimestamp, newestFolder = bpm, timestamp, folder
            end
        elseif ok and bpm then
            detail = detail or "Waiting for a fresh pulse from HypeRate Desktop."
        else
            detail = detail or (ok and timestamp or "Font API error")
            assignmentFailed = assignmentFailed or failed
        end
    end
    if newestBpm then
        fontFolder = newestFolder
        return newestBpm, newestTimestamp
    end
    return nil, detail, assignmentFailed
end

local function poll()
    local now = time()
    local bucket = math.floor(now / INTERVAL)
    updateStatus(now)
    if lastBucket and bucket < lastBucket then
        return
    end
    if bucket ~= lastBucket then
        if now % INTERVAL < LOAD_DELAY then
            pendingSlot = nil
            return
        end
        lastBucket, pendingSlot = bucket, nil
        if usedCount == SLOT_COUNT then
            ticker:Cancel()
            ticker = nil
            showStatus("Font bank used. Restart WoW to continue.")
            return
        end
        local slot = bucket % SLOT_COUNT + 1
        if used[slot] then
            sourceDetail = "Cached slot. Waiting for an unused font."
            return
        end
        used[slot], usedCount = true, usedCount + 1
        pendingSlot, attempts, resetAttempted = slot, 0, false
    end
    if not pendingSlot then
        return
    end

    attempts = attempts + 1
    lastAttemptSlot = pendingSlot
    local ok, bpm, timestamp, assignmentFailed = pcall(readSlot, pendingSlot, now)
    if not ok or not bpm then
        if assignmentFailed and not resetAttempted and attempts >= RESET_AFTER_ATTEMPTS and attempts < MAX_ATTEMPTS then
            resetAttempted = true
            resetMeter()
        end
        if attempts == MAX_ATTEMPTS then
            local slot = pendingSlot
            pendingSlot = nil
            local detail = ok and timestamp or "Font API error"
            sourceDetail = ("Font %04d: %s"):format(slot, detail or "Read failed")
        end
        return
    end
    pendingSlot = nil

    if bpm < 30 or bpm > 240 or timestamp > now or now - timestamp >= MAX_SAMPLE_AGE then
        sourceDetail = "Waiting for a fresh pulse from HypeRate Desktop."
        return
    end
    if timestamp <= lastSample then
        return
    end
    lastSample, lastBpm, sourceDetail = timestamp, bpm, waiting
    updateStatus(now)
    HypeRaid_PublishBpm(bpm, timestamp)
end

function addon.setFontReading(enabled)
    if reading == enabled then
        return
    end
    reading = enabled
    if ticker then
        ticker:Cancel()
        ticker = nil
    end
    pendingSlot = nil
    if enabled then
        sourceDetail = waiting
        ticker = C_Timer.NewTicker(0.5, poll)
        poll()
    else
        lastBpm = nil
        showStatus(nil)
    end
end
