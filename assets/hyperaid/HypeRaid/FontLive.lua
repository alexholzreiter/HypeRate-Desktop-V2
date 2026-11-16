local _, addon = ...
local SLOT_COUNT, INTERVAL = addon.fontBankSize, addon.fontInterval
if SLOT_COUNT == 0 then
    return
end

local FONT_PATH = "Interface\\AddOns\\HypeRaid\\LiveFonts\\Live%04d.ttf"
local LOAD_DELAY = 2
local MAX_SAMPLE_AGE = 25
local measurement = CreateFrame("Frame", nil, UIParent)
local meter = measurement:CreateFontString(nil, "OVERLAY")
meter:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 26, -320)
meter:SetAlpha(0)
meter:SetWordWrap(false)
meter:SetNonSpaceWrap(false)

local used, usedCount = {}, 0
local ticker, lastBucket, pendingSlot, attempts
local reading = false
local lastSample = 0
local lastBpm, displayedStatus
local waiting = "Waiting for HypeRate Desktop."
local sourceDetail = waiting

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

local function decode(slot)
    local path = FONT_PATH:format(slot)
    local assigned = meter:SetFont(path, 64, "")
    -- WoW may assign the font only when a text layout is requested.
    local ready = pcall(function()
        meter:SetText("A~")
        meter:GetStringWidth()
    end)
    local current = meter:GetFont()
    local matches = type(current) == "string" and current:gsub("/", "\\"):lower() == path:lower()
    if not ready or (not assigned and not matches) then
        return nil, "Font assignment pending"
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
        pendingSlot, attempts = slot, 0
    end
    if not pendingSlot then
        return
    end

    attempts = attempts + 1
    local ok, bpm, timestamp = pcall(decode, pendingSlot)
    if not ok or not bpm then
        if attempts == 10 then
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
