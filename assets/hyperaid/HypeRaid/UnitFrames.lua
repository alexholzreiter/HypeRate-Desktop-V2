local _, addon = ...
local API = HypeRaidAPI
local euiReady, sufReady = false, false
local euiNS, feedHeld, lastPlayerRead
local feedOwner = {}

local function notePlayerRead(unit)
    -- Unit tokens are public identifiers; never branch on a secret result.
    if issecretvalue and issecretvalue(unit) then return end
    if unit == "player" then lastPlayerRead = GetTime() end
end

local function renderBPM(unit)
    notePlayerRead(unit)
    local bpm = API.GetBPM(unit)
    return bpm and (tostring(bpm) .. " BPM") or ""
end

local function renderNumber(unit)
    notePlayerRead(unit)
    local bpm = API.GetBPM(unit)
    return bpm and tostring(bpm) or ""
end

-- These are also useful for SUF's user-defined tag editor.
API.FormatBPM = renderBPM
API.FormatNumber = renderNumber

local tags = {
    { key = "hyperaid", fn = renderBPM, method = "FormatBPM", width = 65, sample = "82 BPM" },
    { key = "hyperaidbpm", fn = renderNumber, method = "FormatNumber", width = 28, sample = "82" },
    { key = "hyperate", fn = renderBPM, method = "FormatBPM", width = 65, sample = "82 BPM" },
    { key = "hyperatebpm", fn = renderNumber, method = "FormatNumber", width = 28, sample = "82" },
}

local function registerEUI()
    if euiReady then return end
    local eui = _G.EllesmereUI
    local ns = eui and eui._ModuleNS and eui._ModuleNS.EllesmereUIUnitFrames
    local cat = ns and ns.UF_TextTags
    local schema = cat and cat.schema
    if not (schema and schema.keys and schema.tags and cat.map and cat.names and cat.keys
        and cat.tags and ns.UF_PaintText and ns._internals and ns._internals.frames) then return end
    -- Version-specific extension of the existing catalog; no stock files patched.
    local added = {}
    for _, spec in ipairs(tags) do
        local key = spec.key
        if not cat.map[key] and not schema.keys[key] then
            schema.keys[key] = { reads = "hyperaid", width = spec.width, sample = spec.sample }
            schema.tags[#schema.tags + 1] = { tag = key, keys = { key } }
            cat.map[key], cat.names[key] = spec.fn, key
            cat.keys[#cat.keys + 1] = key
            cat.tags[#cat.tags + 1] = { tag = key, keys = { key } }
            added[#added + 1] = spec
        end
    end
    local oldDescs = schema.descs
    schema.descs = function()
        local descriptions = oldDescs and oldDescs() or {}
        descriptions.tags, descriptions.keys = descriptions.tags or {}, descriptions.keys or {}
        for _, spec in ipairs(added) do
            local label = spec.fn == renderBPM and "Heart rate with BPM" or "Heart rate number"
            descriptions.tags[spec.key] = "HypeRaid: " .. label
            descriptions.keys[spec.key] = label .. ", blank when unavailable"
        end
        return descriptions
    end
    cat.cache, cat.count, cat.descs = {}, 0, nil
    euiNS, euiReady = ns, true
end

local function repaintEUI()
    if not euiReady then return end
    for _, frame in pairs(euiNS._internals.frames) do
        if type(frame) == "table" and frame.IsShown and frame:IsShown() and frame._euiTextZones then
            local usesPulse = false
            for _, zone in ipairs(frame._euiTextZones) do
                for _, piece in ipairs(zone.pieces or {}) do
                    if piece == renderBPM or piece == renderNumber then usesPulse = true; break end
                end
                if usesPulse then break end
            end
            if usesPulse then euiNS.UF_PaintText(frame, frame._euiUnit) end
        end
    end
end

local function registerSUF()
    if sufReady then return end
    local suf = _G.ShadowUF
    local catalog = suf and suf.Tags
    if not (catalog and catalog.defaultTags and catalog.defaultEvents and catalog.defaultFrequents
        and catalog.defaultNames and catalog.defaultHelp and catalog.defaultCategories) then return end
    local customTags = suf.db and suf.db.profile and suf.db.profile.tags
    for _, spec in ipairs(tags) do
        local key = spec.key
        if not catalog.defaultTags[key] and not (customTags and customTags[key]) then
            catalog.defaultTags[key] = "function(unit) local api = _G.HypeRaidAPI; return api and api."
                .. spec.method .. "(unit) or '' end"
            catalog.defaultEvents[key] = "UNIT_NAME_UPDATE"
            catalog.defaultFrequents[key] = 0.5
            catalog.defaultNames[key] = spec.fn == renderBPM and "HypeRaid BPM" or "HypeRaid number"
            catalog.defaultHelp[key] = "Fresh HypeRaid pulse; unavailable and test samples are hidden."
            catalog.defaultCategories[key] = "misc"
        end
    end
    sufReady = true
    if suf.db and catalog.Reload then catalog:Reload() end
end

function addon.getUnitFrameStatus()
    return ("API v1; EllesmereUI tags: %s; SUF tags: %s.")
        :format(euiReady and "ready" or "not loaded / unsupported", sufReady and "ready" or "not loaded / unsupported")
end

local function setup()
    registerEUI()
    registerSUF()
end

local listener = CreateFrame("Frame")
listener:RegisterEvent("ADDON_LOADED")
listener:RegisterEvent("PLAYER_LOGIN")
listener:SetScript("OnEvent", function(_, event, name)
    if event == "PLAYER_LOGIN" or name == "EllesmereUIUnitFrames" or name == "ShadowedUnitFrames" then setup() end
end)
setup() -- OptionalDeps places startup-loaded unit frame addons before this file.

API.RegisterCallback(listener, function() repaintEUI() end)
C_Timer.NewTicker(1, function()
    repaintEUI() -- Also expires text, refreshes remapped units and notices new text slots.
    local wantFeed = lastPlayerRead ~= nil and GetTime() - lastPlayerRead < 3
    if wantFeed and not feedHeld then
        feedHeld = true
        API.AcquireLocalFeed(feedOwner)
    elseif not wantFeed and feedHeld then
        feedHeld = false
        API.ReleaseLocalFeed(feedOwner)
    end
end)
