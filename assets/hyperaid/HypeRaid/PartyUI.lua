local _, addon = ...
local ADDON_TITLE = addon.title
local LOGO = "Interface\\AddOns\\HypeRaid\\HypeRaidLogo"
local HEART = "Interface\\AddOns\\HypeRaid\\HeartBadge"
local HEART_GLOW = "Interface\\AddOns\\HypeRaid\\HeartGlow"
local WHITE = "Interface\\Buttons\\WHITE8X8"
local ROW_HEIGHT, VISIBLE_ROWS = 21, 6
local GRAPH_WIDTH, GRAPH_HEIGHT = 88, 15
local settings = { portrait = false, groupPortraits = true, partyMeter = true, meterGraph = false, heartZones = false,
    recapMode = "off", minimapAngle = 3.85 }
local initialized = false
-- Heart colors by effort. Between two zones the color blends smoothly.
local ZONE_MIN_BPM, ZONE_MAX_BPM = 40, 220
local DEFAULT_ZONES = {
    { bpm = 80, r = 0.25, g = 0.85, b = 0.3 },
    { bpm = 120, r = 1, g = 0.85, b = 0.2 },
    { bpm = 160, r = 0.95, g = 0.2, b = 0.2 },
}
local function defaultZones()
    local zones = {}
    for index, zone in ipairs(DEFAULT_ZONES) do
        zones[index] = { bpm = zone.bpm, r = zone.r, g = zone.g, b = zone.b }
    end
    return zones
end
settings.zoneStops = defaultZones()

-- Accept saved zones only when all three are complete and in ascending BPM order.
local function validZones(zones)
    if type(zones) ~= "table" or #zones ~= #DEFAULT_ZONES then return end
    local result, previous = {}, ZONE_MIN_BPM - 1
    for index, zone in ipairs(zones) do
        if type(zone) ~= "table" then return end
        local bpm, r, g, b = zone.bpm, zone.r, zone.g, zone.b
        if type(bpm) ~= "number" or bpm % 1 ~= 0 or bpm <= previous or bpm > ZONE_MAX_BPM then return end
        for _, value in ipairs({ r, g, b }) do
            if type(value) ~= "number" or value < 0 or value > 1 then return end
        end
        result[index], previous = { bpm = bpm, r = r, g = g, b = b }, bpm
    end
    return result
end
local recapModes = { "off", "instances", "raids", "solo", "all" }
local recapLabels = { off = "Off", instances = "Instances incl. raids", raids = "Raids only",
    solo = "Solo fights only", all = "All fights" }

local function panel(name, width, height)
    local frame = CreateFrame("Frame", name, UIParent, "BackdropTemplate")
    frame:SetSize(width, height)
    frame:SetClampedToScreen(true)
    frame:SetBackdrop({ bgFile = WHITE, edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 13,
        insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    frame:SetBackdropColor(0.035, 0.037, 0.048, 0.94)
    frame:SetBackdropBorderColor(0.67, 0.51, 0.28, 0.95)
    frame:EnableMouse(true)
    frame:Hide()
    return frame
end

local function header(frame, closeHandler)
    local bar = CreateFrame("Frame", nil, frame)
    bar:SetPoint("TOPLEFT", 3, -3)
    bar:SetPoint("TOPRIGHT", -3, -3)
    bar:SetHeight(30)
    local background = bar:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0.11, 0.092, 0.071, 0.95)
    local icon = bar:CreateTexture(nil, "ARTWORK")
    icon:SetPoint("LEFT", 6, 0)
    icon:SetSize(24, 24)
    icon:SetTexture(LOGO)
    local title = bar:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("LEFT", icon, "RIGHT", 5, 0)
    title:SetText(ADDON_TITLE)
    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -2, -2)
    close:SetScript("OnClick", closeHandler)
    return bar
end

local function nativeButton(parent, text, width, action)
    local button = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    button:SetSize(width, 23)
    button:SetText(text)
    button:SetScript("OnClick", action)
    return button
end

local function positionPanel(frame, x, y)
    frame:ClearAllPoints()
    frame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", x, y)
end

local function makeDraggable(frame, bar, xKey, yKey)
    frame:SetMovable(true)
    bar:EnableMouse(true)
    bar:RegisterForDrag("LeftButton")
    bar:SetScript("OnDragStart", function() frame:StartMoving() end)
    bar:SetScript("OnDragStop", function()
        frame:StopMovingOrSizing()
        local left, top = frame:GetLeft(), frame:GetTop()
        if left and top then
            settings[xKey] = left - UIParent:GetLeft()
            settings[yKey] = top - UIParent:GetTop()
            positionPanel(frame, settings[xKey], settings[yKey])
        end
    end)
end

local options = panel("HypeRaidSettingsFrame", 274, 343)
options:SetFrameStrata("DIALOG")
options:SetPoint("RIGHT", Minimap or UIParent, Minimap and "LEFT" or "RIGHT", -14, -12)
local optionsHeader = header(options, function() options:Hide() end)
makeDraggable(options, optionsHeader, "optionsX", "optionsY")

local function option(text, y, onClick)
    local checkbox = CreateFrame("CheckButton", nil, options, "UICheckButtonTemplate")
    checkbox:SetPoint("TOPLEFT", 12, y)
    checkbox:SetSize(26, 26)
    local label = options:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("LEFT", checkbox, "RIGHT", 4, 0)
    label:SetText(text)
    checkbox:SetHitRectInsets(0, -label:GetStringWidth() - 8, 0, 0)
    checkbox:SetScript("OnClick", function(self) onClick(self:GetChecked()) end)
    return checkbox
end

local share = option("Share my BPM", -39, function(value) addon.setSharing(value) end)
local portraitOption = option("Show on player portrait", -66, function(value)
    settings.portrait = value and true or false
    addon.syncFontReader()
    addon.refreshUI()
end)
local meterOption = option("Show party meter", -93, function(value)
    settings.partyMeter = value and true or false
    addon.syncFontReader()
    addon.refreshUI()
end)
local groupPortraitOption = option("Show on group portraits", -120, function(value)
    settings.groupPortraits = value and true or false
    addon.refreshUI()
end)
local graphOption = option("Show pulse graph in meter", -147, function(value)
    settings.meterGraph = value and true or false
    addon.refreshUI()
end)
local zoneOption = option("Color heart by BPM", -174, function(value)
    settings.heartZones = value and true or false
    addon.refreshUI()
end)

-- Zone editor: one color and one BPM value per zone.
local zoneEditor = panel("HypeRaidZoneEditor", 236, 196)
zoneEditor:SetFrameStrata("DIALOG")
zoneEditor:SetPoint("TOPLEFT", options, "TOPRIGHT", 6, 0)
makeDraggable(zoneEditor, header(zoneEditor, function() zoneEditor:Hide() end), "zonesX", "zonesY")
local zoneHint = zoneEditor:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
zoneHint:SetPoint("TOPLEFT", 14, -40)
zoneHint:SetPoint("RIGHT", zoneEditor, "RIGHT", -14, 0)
zoneHint:SetJustifyH("LEFT")
zoneHint:SetText("Colors blend between the zones.")
local zoneLabels = { "Calm up to", "Active at", "Intense from" }
local zoneRows = {}

local function refreshZoneEditor()
    for index, row in ipairs(zoneRows) do
        local zone = settings.zoneStops[index]
        row.swatch.color:SetColorTexture(zone.r, zone.g, zone.b)
        if not row.input:HasFocus() then row.input:SetText(tostring(zone.bpm)) end
    end
end

local function openColorPicker(zone)
    local previous = { r = zone.r, g = zone.g, b = zone.b }
    local function apply(r, g, b)
        zone.r, zone.g, zone.b = r, g, b
        refreshZoneEditor()
        addon.refreshUI()
    end
    local function onChange() apply(ColorPickerFrame:GetColorRGB()) end
    local function onCancel() apply(previous.r, previous.g, previous.b) end
    ColorPickerFrame:SetFrameStrata("FULLSCREEN_DIALOG")
    if ColorPickerFrame.SetupColorPickerAndShow then
        ColorPickerFrame:SetupColorPickerAndShow({ r = zone.r, g = zone.g, b = zone.b, hasOpacity = false,
            swatchFunc = onChange, cancelFunc = onCancel })
    else
        ColorPickerFrame:Hide()
        ColorPickerFrame.hasOpacity, ColorPickerFrame.opacityFunc = false, nil
        ColorPickerFrame.func, ColorPickerFrame.cancelFunc = onChange, onCancel
        ColorPickerFrame.previousValues = previous
        ColorPickerFrame:SetColorRGB(zone.r, zone.g, zone.b)
        ColorPickerFrame:Show()
    end
end

-- Apply a typed BPM only when it keeps the zones in ascending order; otherwise restore it.
local function applyZoneBpm(index, input)
    local zones, value = settings.zoneStops, tonumber(input:GetText())
    local low = index > 1 and zones[index - 1].bpm or ZONE_MIN_BPM - 1
    local high = index < #zones and zones[index + 1].bpm or ZONE_MAX_BPM + 1
    if value and value % 1 == 0 and value > low and value < high then
        zones[index].bpm = value
        addon.refreshUI()
    end
    input:SetText(tostring(zones[index].bpm))
end

for index, labelText in ipairs(zoneLabels) do
    local y = -64 - (index - 1) * 32
    local swatch = CreateFrame("Button", nil, zoneEditor, "BackdropTemplate")
    swatch:SetPoint("TOPLEFT", 14, y)
    swatch:SetSize(22, 22)
    swatch:SetBackdrop({ edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 8,
        insets = { left = 2, right = 2, top = 2, bottom = 2 } })
    swatch:SetBackdropBorderColor(0.67, 0.51, 0.28, 0.95)
    swatch.color = swatch:CreateTexture(nil, "ARTWORK")
    swatch.color:SetPoint("TOPLEFT", 3, -3)
    swatch.color:SetPoint("BOTTOMRIGHT", -3, 3)
    swatch:SetScript("OnClick", function() openColorPicker(settings.zoneStops[index]) end)
    swatch:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
        GameTooltip:SetText("Click to choose a color.")
        GameTooltip:Show()
    end)
    swatch:SetScript("OnLeave", function(self)
        if GameTooltip:IsOwned(self) then GameTooltip:Hide() end
    end)
    local label = zoneEditor:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("LEFT", swatch, "RIGHT", 8, 0)
    label:SetText(labelText)
    local unit = zoneEditor:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    unit:SetPoint("RIGHT", zoneEditor, "TOPRIGHT", -14, y - 11)
    unit:SetText("BPM")
    local input = CreateFrame("EditBox", nil, zoneEditor, "InputBoxTemplate")
    input:SetSize(38, 20)
    input:SetPoint("RIGHT", unit, "LEFT", -6, 0)
    input:SetAutoFocus(false)
    input:SetNumeric(true)
    input:SetMaxLetters(3)
    input:SetJustifyH("CENTER")
    input:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
    input:SetScript("OnEscapePressed", function(self)
        self:SetText(tostring(settings.zoneStops[index].bpm))
        self:ClearFocus()
    end)
    input:SetScript("OnEditFocusLost", function(self) applyZoneBpm(index, self) end)
    zoneRows[index] = { swatch = swatch, input = input }
end

local zoneDefaults = nativeButton(zoneEditor, "Defaults", 84, function()
    settings.zoneStops = defaultZones()
    refreshZoneEditor()
    addon.refreshUI()
end)
zoneDefaults:SetPoint("BOTTOMLEFT", 12, 11)
local zoneClose = nativeButton(zoneEditor, "Close", 72, function() zoneEditor:Hide() end)
zoneClose:SetPoint("BOTTOMRIGHT", -12, 11)
zoneEditor:SetScript("OnShow", refreshZoneEditor)
options:HookScript("OnHide", function() zoneEditor:Hide() end)

local zoneButton = nativeButton(options, "Zones", 64, function()
    zoneEditor:SetShown(not zoneEditor:IsShown())
end)
zoneButton:SetPoint("TOPRIGHT", -12, -175)
local function selectRecapMode(mode)
    settings.recapMode = mode
    addon.syncFontReader()
    addon.refreshUI()
end
local recapLabel = options:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
recapLabel:SetPoint("TOPLEFT", 16, -209)
recapLabel:SetText("Auto-open recap")
local recapOption = nativeButton(options, recapLabels.off, 135, function(button)
    if MenuUtil and MenuUtil.CreateContextMenu then
        MenuUtil.CreateContextMenu(button, function(_, menu)
            for _, mode in ipairs(recapModes) do
                menu:CreateRadio(recapLabels[mode], function(value) return settings.recapMode == value end,
                    selectRecapMode, mode)
            end
        end)
        return
    end
    for index, mode in ipairs(recapModes) do
        if mode == settings.recapMode then
            selectRecapMode(recapModes[index % #recapModes + 1])
            return
        end
    end
end)
recapOption:SetPoint("TOPRIGHT", -12, -202)
local actionIconLabel = options:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
actionIconLabel:SetPoint("TOPLEFT", 16, -236)
actionIconLabel:SetText("Action bar icon")
local actionIconButton = nativeButton(options, "Pick up", 90, function() addon.pickupActionIcon() end)
actionIconButton:SetPoint("TOPRIGHT", -12, -229)

local status = options:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
status:SetPoint("TOPLEFT", 16, -262)
status:SetPoint("RIGHT", options, "RIGHT", -16, 0)
status:SetJustifyH("LEFT")
local test = nativeButton(options, "Send test", 90, addon.sendTest)
test:SetPoint("BOTTOMLEFT", 12, 11)
local close = nativeButton(options, "Close", 72, function() options:Hide() end)
close:SetPoint("BOTTOMRIGHT", -12, 11)

local placeMinimapIcon
if Minimap then
    local minimapButton = CreateFrame("Button", "HypeRaidMinimapButton", Minimap)
    minimapButton:SetSize(27, 27)
    minimapButton:SetFrameStrata("MEDIUM")
    minimapButton:SetFrameLevel(Minimap:GetFrameLevel() + 8)
    local icon = minimapButton:CreateTexture(nil, "ARTWORK")
    icon:SetAllPoints()
    icon:SetTexture(LOGO)
    minimapButton:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
    minimapButton:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:SetText(ADDON_TITLE)
        local bpm, age, sending = addon.getLocalPulseStatus()
        if bpm then
            GameTooltip:AddLine(("Live pulse: %d BPM"):format(bpm), 0.6, 1, 0.7)
        elseif age then
            GameTooltip:AddLine(("Last sample: %ds ago"):format(age), 1, 0.8, 0.5)
        else
            GameTooltip:AddLine("Waiting for a local pulse.", 0.8, 0.8, 0.8)
        end
        local _, sharing = addon.getGroupState()
        local shareText = bpm and sending and "Sharing with group" or (sharing and "Sharing enabled · waiting to send" or "Your BPM is private")
        GameTooltip:AddLine(shareText, 1, 1, 1)
        GameTooltip:AddLine("Click for settings. Drag to move.", 1, 1, 1)
        GameTooltip:Show()
    end)
    minimapButton:SetScript("OnLeave", function() GameTooltip:Hide() end)
    minimapButton:SetScript("OnClick", function() addon.toggleSettings() end)

    placeMinimapIcon = function()
        minimapButton:ClearAllPoints()
        minimapButton:SetPoint("CENTER", Minimap, "CENTER",
            math.cos(settings.minimapAngle) * (Minimap:GetWidth() / 2 + 1),
            math.sin(settings.minimapAngle) * (Minimap:GetHeight() / 2 + 1))
    end

    minimapButton:RegisterForDrag("LeftButton")
    minimapButton:SetScript("OnDragStart", function(self)
        GameTooltip:Hide()
        self:SetScript("OnUpdate", function()
            local x, y = GetCursorPosition()
            local centerX, centerY = Minimap:GetCenter()
            local scale = Minimap:GetEffectiveScale()
            if centerX and centerY then
                settings.minimapAngle = (math.atan2 or math.atan)(y / scale - centerY, x / scale - centerX)
                placeMinimapIcon()
            end
        end)
    end)
    minimapButton:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
    Minimap:HookScript("OnSizeChanged", placeMinimapIcon)
    placeMinimapIcon()
end

local meter = panel("HypeRaidMeter", 282, 68)
meter:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -35, 132)
meter:SetFrameStrata("MEDIUM")
local meterHeader = header(meter, function()
    settings.partyMeter = false
    addon.syncFontReader()
    addon.refreshUI()
end)
makeDraggable(meter, meterHeader, "meterX", "meterY")

local details = panel("HypeRaidFightDetails", 306, 200)
details:SetFrameStrata("DIALOG")
details:SetPoint("CENTER", UIParent, "CENTER", 0, 110)
makeDraggable(details, header(details, function() details:Hide() end), "detailsX", "detailsY")
local detailsTitle = details:CreateFontString(nil, "OVERLAY", "GameFontNormal")
detailsTitle:SetPoint("TOPLEFT", 14, -39)
detailsTitle:SetPoint("RIGHT", details, "RIGHT", -14, 0)
detailsTitle:SetJustifyH("LEFT")
detailsTitle:SetWordWrap(false)
local detailsScroll = CreateFrame("ScrollFrame", nil, details, "UIPanelScrollFrameTemplate")
detailsScroll:SetPoint("TOPLEFT", 14, -59)
detailsScroll:SetPoint("BOTTOMRIGHT", -27, 12)
local detailsContent = CreateFrame("Frame", nil, detailsScroll)
detailsContent:SetSize(262, 115)
detailsScroll:SetScrollChild(detailsContent)
local detailsText = detailsContent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
detailsText:SetPoint("TOPLEFT")
detailsText:SetPoint("RIGHT")
detailsText:SetJustifyH("LEFT")
detailsText:SetSpacing(5)

local mode, autoUntil, seenFight
local function showDetails(view)
    mode, autoUntil = view, nil
    detailsScroll:SetVerticalScroll(0)
    details:Show()
    addon.refreshUI()
end
local recap = nativeButton(meterHeader, "Last fight", 71, function() showDetails("fight") end)
recap:SetPoint("RIGHT", -98, 0)
local recordsButton = nativeButton(meterHeader, "Records", 62, function() showDetails("records") end)
recordsButton:SetPoint("RIGHT", -32, 0)

local function shouldOpenRecap(fight)
    local mode = settings.recapMode
    return fight and (mode == "all" or (mode == "instances" and fight.inInstance)
        or (mode == "raids" and fight.inRaid) or (mode == "solo" and fight.solo))
end

local function refreshFightDetails()
    local fight, records, inCombat = addon.getFightSummary()
    if fight and fight ~= seenFight then
        seenFight = fight
        if shouldOpenRecap(fight) and (not details:IsShown() or autoUntil) then
            mode, autoUntil = "fight", fight.finishedAt + 9
            detailsScroll:SetVerticalScroll(0)
            details:Show()
        end
    end
    if autoUntil and (inCombat or GetTime() >= autoUntil or not shouldOpenRecap(fight)) then
        autoUntil = nil
        details:Hide()
    end
    if not details:IsShown() then return end

    local lines = {}
    if mode == "records" then
        detailsTitle:SetText("Personal records · this session")
        for index, row in ipairs(records) do
            lines[index] = ("%d. %d BPM  ·  %s"):format(index, row.peak, row.name)
        end
    else
        detailsTitle:SetText(fight and ("Last fight · " .. fight.name) or "Last fight")
        if fight then
            for index, row in ipairs(fight.rows) do
                lines[index] = ("%s  %d to %d BPM  (+%d)%s"):format(row.name, row.start, row.peak,
                    row.peak - row.start, row.late and " *" or "")
            end
            for _, row in ipairs(fight.rows) do
                if row.late then
                    lines[#lines + 1] = "* First reading arrived after combat started."
                    break
                end
            end
        end
    end
    detailsText:SetText(#lines > 0 and table.concat(lines, "\n") or "No combat pulse readings yet.")
    local availableHeight, textHeight = detailsScroll:GetHeight(), detailsText:GetStringHeight() + 4
    detailsContent:SetHeight(math.max(availableHeight, textHeight))
    if detailsScroll.ScrollBar then detailsScroll.ScrollBar:SetShown(textHeight > availableHeight) end
end

local scroll = CreateFrame("ScrollFrame", nil, meter, "UIPanelScrollFrameTemplate")
scroll:SetPoint("TOPLEFT", 10, -38)
scroll:SetPoint("BOTTOMRIGHT", -27, 9)
local content = CreateFrame("Frame", nil, scroll)
content:SetSize(244, ROW_HEIGHT)
scroll:SetScrollChild(content)
local empty = content:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
empty:SetPoint("TOPLEFT", 4, -4)
local bars = {}
local scrollbarVisible
local hoveredBar

local function pulseGraph(parent, width, height)
    local graph = CreateFrame("Frame", nil, parent)
    graph:SetSize(width, height)
    graph.segments = {}
    graph.dot = graph:CreateTexture(nil, "OVERLAY")
    graph.dot:SetSize(3, 3)
    graph:Hide()
    return graph
end

local hover = panel(nil, 222, 102)
hover:SetFrameStrata("TOOLTIP")
hover:EnableMouse(false)
local hoverName = hover:CreateFontString(nil, "OVERLAY", "GameFontNormal")
hoverName:SetPoint("TOPLEFT", 12, -10)
hoverName:SetPoint("RIGHT", hover, "RIGHT", -12, 0)
hoverName:SetJustifyH("LEFT")
hoverName:SetWordWrap(false)
local hoverStats = hover:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
hoverStats:SetPoint("TOPLEFT", 12, -28)
local hoverGraph = pulseGraph(hover, 198, 37)
hoverGraph:SetPoint("BOTTOMLEFT", 12, 11)
local refreshHover

local function rowBar(index)
    if bars[index] then
        return bars[index]
    end
    local bar = CreateFrame("StatusBar", nil, content)
    bar:SetPoint("TOPLEFT", 0, -(index - 1) * ROW_HEIGHT)
    bar:SetPoint("RIGHT", content, "RIGHT", 0, 0)
    bar:SetHeight(ROW_HEIGHT - 2)
    bar:SetStatusBarTexture(WHITE)
    bar:SetMinMaxValues(0, 160)
    local background = bar:CreateTexture(nil, "BACKGROUND")
    background:SetAllPoints()
    background:SetColorTexture(0.13, 0.12, 0.125, 0.93)
    local bpm = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    bpm:SetPoint("RIGHT", -6, 0)
    bpm:SetJustifyH("RIGHT")
    local graph = pulseGraph(bar, GRAPH_WIDTH, GRAPH_HEIGHT)
    graph:SetPoint("RIGHT", bpm, "LEFT", -8, 0)
    local name = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    name:SetPoint("LEFT", 6, 0)
    name:SetPoint("RIGHT", bpm, "LEFT", -8, 0)
    name:SetJustifyH("LEFT")
    name:SetWordWrap(false)
    bar.bpm, bar.name, bar.graph = bpm, name, graph
    bar:EnableMouse(true)
    bar:SetScript("OnEnter", function(self)
        hoveredBar = self
        refreshHover()
    end)
    local function stopHover(self)
        if hoveredBar == self then
            hoveredBar = nil
            hover:Hide()
        end
    end
    bar:SetScript("OnLeave", stopHover)
    bar:SetScript("OnHide", stopHover)
    bars[index] = bar
    return bar
end

local function drawGraph(graph, history, r, g, b)
    local count = history and #history or 0
    graph:SetShown(count > 0)
    if count == 0 then
        return
    end

    local low, high = history[1].bpm, history[1].bpm
    for index = 2, count do
        low = math.min(low, history[index].bpm)
        high = math.max(high, history[index].bpm)
    end
    local middle = (high + low) / 2
    local range = math.max(high - low, 16)
    local latest = history[count].time
    local width, height = graph:GetSize()
    local previousX, previousY
    for index, sample in ipairs(history) do
        local x = width - 2 - (latest - sample.time) / addon.chartSeconds * (width - 4)
        local y = height / 2 + (sample.bpm - middle) / range * (height - 4)
        if index > 1 then
            local line = graph.segments[index - 1]
            if not line then
                line = graph:CreateLine(nil, "ARTWORK")
                line:SetThickness(1.5)
                graph.segments[index - 1] = line
            end
            line:SetStartPoint("BOTTOMLEFT", graph, previousX, previousY)
            line:SetEndPoint("BOTTOMLEFT", graph, x, y)
            line:SetColorTexture(r, g, b, 0.95)
            line:Show()
        end
        previousX, previousY = x, y
    end
    for index = count, #graph.segments do
        graph.segments[index]:Hide()
    end
    graph.dot:SetPoint("CENTER", graph, "BOTTOMLEFT", previousX, previousY)
    graph.dot:SetColorTexture(r, g, b, 1)
end

refreshHover = function()
    local row = hoveredBar and hoveredBar.pulseRow
    if not row or row.test or not row.history or #row.history == 0 then
        hover:Hide()
        return
    end
    local peak, cutoff = row.bpm, GetTime() - addon.chartSeconds
    for _, sample in ipairs(row.history) do
        if sample.time >= cutoff then peak = math.max(peak, sample.bpm) end
    end
    hoverName:SetText(row.name)
    hoverStats:SetText(("%d BPM · 60s peak %d\nLast reading %ds ago"):format(row.bpm, peak, math.floor(row.age or 0)))
    hover:ClearAllPoints()
    hover:SetPoint("BOTTOMLEFT", hoveredBar, "TOPLEFT", 0, 4)
    drawGraph(hoverGraph, row.history, 0.95, 0.55, 0.58)
    hover:Show()
end

local function refreshMeter(inGroup)
    meter:SetShown(settings.partyMeter)
    if not settings.partyMeter then
        return
    end

    local rows = addon.getPartyRows()
    table.sort(rows, function(left, right)
        if left.bpm == right.bpm then
            return left.name < right.name
        end
        return left.bpm > right.bpm
    end)

    empty:SetShown(#rows == 0)
    if #rows == 0 then
        empty:SetText(inGroup and "No group members sharing BPM." or "Join a group to see shared BPM.")
    end
    local needsScroll = #rows > VISIBLE_ROWS
    if needsScroll ~= scrollbarVisible then
        scrollbarVisible = needsScroll
        content:SetWidth(needsScroll and 244 or 262)
        scroll:SetPoint("BOTTOMRIGHT", needsScroll and -27 or -10, 9)
        if scroll.ScrollBar then
            scroll.ScrollBar:SetShown(needsScroll)
        end
    end
    content:SetHeight(math.max(1, #rows) * ROW_HEIGHT)
    meter:SetHeight(47 + math.max(1, math.min(#rows, VISIBLE_ROWS)) * ROW_HEIGHT)
    if not needsScroll and scroll:GetVerticalScroll() ~= 0 then
        scroll:SetVerticalScroll(0)
    end
    for index, row in ipairs(rows) do
        local bar = rowBar(index)
        bar.pulseRow = row
        local color = type(row.class) == "string" and RAID_CLASS_COLORS and RAID_CLASS_COLORS[row.class]
        local r, g, b = 0.57, 0.26, 0.25
        if color then r, g, b = color.r, color.g, color.b end
        local graphMode = settings.meterGraph
        bar:SetStatusBarColor(r, g, b, graphMode and 0 or (color and 0.64 or 0.83))
        bar:SetMinMaxValues(0, math.max(160, rows[1].bpm))
        bar:SetValue(row.bpm)
        bar.name:SetText(row.name)
        bar.bpm:SetText(("%d BPM%s"):format(row.bpm, row.test and " (test)" or ""))
        bar.name:SetPoint("RIGHT", graphMode and not row.test and bar.graph or bar.bpm, "LEFT", -8, 0)
        if graphMode and not row.test then
            drawGraph(bar.graph, row.history, r, g, b)
        else
            bar.graph:Hide()
        end
        bar:Show()
    end
    for index = #rows + 1, #bars do
        bars[index]:Hide()
    end
    if hoveredBar then refreshHover() end
end

local function showPortraitTooltip(badge)
    local bpm = badge.currentBpm
    GameTooltip:SetText(bpm and ("%d BPM"):format(bpm) or "Waiting for a fresh pulse.")
    if bpm and badge.stale then
        GameTooltip:AddLine(("Last reading %ds ago. Waiting for a fresh pulse."):format(math.floor(badge.age or 0)),
            0.8, 0.8, 0.8)
    elseif bpm and badge.history then
        local now = GetTime()
        for _, sample in ipairs(badge.history) do
            local age = now - sample.time
            if age >= 7 and age <= 30 then
                GameTooltip:AddLine(("Pulse change: %+d BPM"):format(bpm - sample.bpm), 1, 1, 1)
                GameTooltip:AddLine("Compared with an earlier reading in the last 30 seconds.", 0.8, 0.8, 0.8)
                break
            end
        end
    end
    GameTooltip:Show()
end

local function zoneColor(bpm)
    local ZONE_STOPS = settings.zoneStops
    local first, last = ZONE_STOPS[1], ZONE_STOPS[#ZONE_STOPS]
    if bpm <= first.bpm then return first.r, first.g, first.b end
    if bpm >= last.bpm then return last.r, last.g, last.b end
    for index = 2, #ZONE_STOPS do
        local high = ZONE_STOPS[index]
        if bpm <= high.bpm then
            local low = ZONE_STOPS[index - 1]
            local t = (bpm - low.bpm) / (high.bpm - low.bpm)
            return low.r + (high.r - low.r) * t, low.g + (high.g - low.g) * t, low.b + (high.b - low.b) * t
        end
    end
end

-- Recolor only the heart with a tinted copy of its mask; the badge's own red heart shows when off.
local function setHeartColor(badge, bpm)
    if bpm and settings.heartZones then
        local r, g, b = zoneColor(bpm)
        badge.tint:SetVertexColor(r, g, b)
        badge.tint:Show()
        badge.glow:SetVertexColor(r, g, b)
    else
        badge.tint:Hide()
        badge.glow:SetVertexColor(1, 0.59, 0.59)
    end
end

-- Glow over one beat: a strong first pulse, a softer second one, then a slow fade.
local function beatGlow(phase)
    if phase < 0.1 then
        return phase / 0.1
    elseif phase < 0.2 then
        return 1 - (phase - 0.1) / 0.1 * 0.6
    elseif phase < 0.28 then
        return 0.4 + (phase - 0.2) / 0.08 * 0.3
    end
    return 0.7 * math.max(0, 1 - (phase - 0.28) / 0.45)
end

local function animateHeart(badge, elapsed)
    badge.beatPhase = (badge.beatPhase + elapsed * badge.beatBpm / 60) % 1
    badge.glow:SetAlpha(0.85 * beatGlow(badge.beatPhase))
end

-- Beat at the last known BPM, also through gaps in the feed. Only a missing reading rests the heart.
local function setHeartBeat(badge, bpm)
    if bpm == badge.beatBpm then return end
    badge.beatBpm = bpm
    if bpm then
        badge:SetScript("OnUpdate", animateHeart)
    else
        badge:SetScript("OnUpdate", nil)
        badge.glow:SetAlpha(0)
    end
end

local function createPortraitBadge(name, size, fontSize)
    local badge = CreateFrame("Frame", name, UIParent)
    badge:SetSize(size, size)
    badge:SetFrameStrata("MEDIUM")
    badge:Hide()
    local heart = badge:CreateTexture(nil, "ARTWORK")
    heart:SetAllPoints()
    heart:SetTexture(HEART)
    -- Heart-only mask: a tinted copy recolors the heart, an added copy lights it up on each beat.
    local tint = badge:CreateTexture(nil, "ARTWORK", nil, 1)
    tint:SetAllPoints()
    tint:SetTexture(HEART_GLOW)
    tint:Hide()
    local glow = badge:CreateTexture(nil, "ARTWORK", nil, 2)
    glow:SetAllPoints()
    glow:SetTexture(HEART_GLOW)
    glow:SetBlendMode("ADD")
    glow:SetAlpha(0)
    glow:SetVertexColor(1, 0.59, 0.59)
    badge.tint, badge.glow, badge.beatPhase = tint, glow, 0
    local pulse = badge:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    pulse:SetPoint("CENTER")
    local font = pulse:GetFont()
    if font then
        pulse:SetFont(font, fontSize, "OUTLINE")
    end
    pulse:SetTextColor(1, 0.96, 0.84)
    badge.pulse, badge.heart = pulse, heart
    if badge.SetMouseMotionEnabled and badge.SetMouseClickEnabled then
        badge:SetMouseMotionEnabled(true)
        badge:SetMouseClickEnabled(false)
        badge:SetScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            showPortraitTooltip(self)
        end)
        local function hideTooltip(self)
            if GameTooltip:IsOwned(self) then GameTooltip:Hide() end
        end
        badge:SetScript("OnLeave", hideTooltip)
        badge:SetScript("OnHide", hideTooltip)
    end
    return badge
end

local function setBadgeValue(badge, bpm, history, age, stale)
    badge.pulse:SetText(bpm and tostring(bpm) or "--")
    setHeartBeat(badge, bpm)
    setHeartColor(badge, bpm)
    badge.currentBpm, badge.history, badge.age, badge.stale = bpm, history, age, stale
    badge:Show()
    if GameTooltip:IsOwned(badge) then showPortraitTooltip(badge) end
end

local function showPortraitBadge(badge, frame, anchor, corner, x, y, bpm, history, age, stale)
    if anchor ~= badge.portraitAnchor then
        badge.portraitAnchor = anchor
        badge:ClearAllPoints()
        badge:SetPoint("CENTER", anchor, corner, x, y)
    end
    local scale = frame:GetEffectiveScale() / UIParent:GetEffectiveScale()
    if scale ~= badge.portraitScale then
        badge.portraitScale = scale
        badge:SetScale(scale)
    end
    setBadgeValue(badge, bpm, history, age, stale)
end

local badge = createPortraitBadge("HypeRaidPortraitBadge", 32, 12)
local targetBadge = createPortraitBadge("HypeRaidTargetBadge", 32, 12)
local partyBadges = {}
for index = 1, 4 do
    partyBadges[index] = createPortraitBadge(nil, 26, 10)
end

local function refreshPortrait()
    if not settings.portrait or not PlayerFrame or not PlayerFrame:IsVisible() then
        badge:Hide()
        return
    end
    local container = PlayerFrame.PlayerFrameContainer
    local portrait = (container and (container.PlayerPortrait or container.Portrait)) or PlayerPortrait
        or PlayerFrame.portrait or PlayerFrame.Portrait
    local bpm, age, stale = addon.getLocalDisplayBpm()
    if portrait then
        showPortraitBadge(badge, PlayerFrame, portrait, "TOPLEFT", 5, -5, bpm, addon.getLocalHistory(), age, stale)
    else
        showPortraitBadge(badge, PlayerFrame, PlayerFrame, "TOPLEFT", 17, -9, bpm, addon.getLocalHistory(), age, stale)
    end
end

local function refreshSharedBadge(badge, frame, portrait, unit, corner, x)
    local bpm, history, age, stale
    if portrait and (not portrait.IsVisible or portrait:IsVisible()) then
        bpm, history, age, stale = addon.getSharedBpm(unit, true)
    end
    if bpm then
        showPortraitBadge(badge, frame, portrait, corner, x, -5, bpm, history, age, stale)
    else
        badge:Hide()
    end
end

local function refreshGroupPortraits(inGroup)
    local enabled = inGroup and settings.groupPortraits
    local targetPortrait
    if enabled and TargetFrame and TargetFrame:IsVisible() then
        local container = TargetFrame.TargetFrameContainer
        targetPortrait = TargetFrame.portrait or (container and (container.Portrait or container.TargetPortrait))
            or TargetFramePortrait
    end
    refreshSharedBadge(targetBadge, TargetFrame, targetPortrait, "target", "TOPRIGHT", -5)

    for index, partyBadge in ipairs(partyBadges) do
        local frame, portrait, unit
        if enabled then
            local member = "MemberFrame" .. index
            frame = (PartyFrame and PartyFrame[member]) or _G["Party" .. member]
            if frame and frame:IsVisible() then
                portrait = frame.Portrait or frame.portrait or _G["Party" .. member .. "Portrait"]
                unit = (frame.GetUnit and frame:GetUnit()) or frame.unit or frame:GetAttribute("unit") or "party" .. index
            end
        end
        refreshSharedBadge(partyBadge, frame, portrait, unit, "TOPLEFT", 5)
    end
end

-- Action bar icon: a "HypeRaid" macro the player places on a Blizzard action bar.
-- A badge drawn over every button that holds it shows the player's own BPM.
local MACRO_NAME, MACRO_BODY = "HypeRaid", "/hyperaid"
local MACRO_ICONS = { 134400, "INV_Misc_QuestionMark" }
local ACTION_BARS = { "ActionButton", "MultiBarBottomLeftButton", "MultiBarBottomRightButton",
    "MultiBarRightButton", "MultiBarLeftButton", "MultiBar5Button", "MultiBar6Button", "MultiBar7Button" }
local actionBadges, actionButtons = {}, {}
local hasActionIcon = false

local function secret(value)
    return issecretvalue and issecretvalue(value)
end

local function buttonAction(button)
    local action = button.action
    if type(action) ~= "number" and button.GetPagedID then action = button:GetPagedID() end
    if type(action) ~= "number" and ActionButton_GetPagedID then action = ActionButton_GetPagedID(button) end
    if type(action) == "number" and not secret(action) then return action end
end

local function holdsHypeRaidMacro(action, macroIndex)
    local kind, id = GetActionInfo(action)
    if secret(kind) or secret(id) or kind ~= "macro" then return false end
    if id == macroIndex then return true end
    local text = GetActionText(action)
    return not secret(text) and text == MACRO_NAME
end

-- The action bar icon reuses the portrait badge art on a dark square, slightly smaller than the
-- button. The layers are drawn on the button itself, right above its own icon, so the button's
-- border and highlight stay on top like on any action.
local BADGE_INSET = 0.07

local function iconRegion(button)
    return button.icon or button.Icon or (button.GetName and _G[(button:GetName() or "") .. "Icon"])
end

local function iconLayer(button, region, layers)
    local icon = iconRegion(button)
    local layer, sublevel = "BACKGROUND", 0
    if icon and icon.GetDrawLayer then layer, sublevel = icon:GetDrawLayer() end
    sublevel = math.min(sublevel or 0, 7 - #layers)
    for index, spec in ipairs(layers) do
        local texture = button:CreateTexture(nil, layer, nil, sublevel + index)
        texture:SetAllPoints(region)
        if spec.file then texture:SetTexture(spec.file) else texture:SetColorTexture(unpack(spec.color)) end
        if spec.add then texture:SetBlendMode("ADD") end
        -- Clip to the same shape as the button's own icon, so nothing shows outside its border.
        local mask = button.IconMask
        if mask and texture.AddMaskTexture then texture:AddMaskTexture(mask) end
        spec.texture = texture
    end
end

-- Keep the round badge a little inside the button; follows the button's size.
local function fitActionBadge(actionBadge)
    local width = actionBadge.region:GetWidth()
    if not width or width <= 0 or width == actionBadge.fittedWidth then return end
    actionBadge.fittedWidth = width
    local inset = width * BADGE_INSET
    for index = 2, #actionBadge.layers do
        local texture = actionBadge.layers[index]
        texture:ClearAllPoints()
        texture:SetPoint("TOPLEFT", actionBadge.region, "TOPLEFT", inset, -inset)
        texture:SetPoint("BOTTOMRIGHT", actionBadge.region, "BOTTOMRIGHT", -inset, inset)
    end
end

local function createActionBadge(button)
    local region = iconRegion(button) or button
    local layers = { { color = { 0.04, 0.035, 0.03, 1 } }, { file = HEART }, { file = HEART_GLOW },
        { file = HEART_GLOW, add = true } }
    iconLayer(button, region, layers)
    -- The badge frame only carries the BPM text, the tooltip and the beat animation.
    local actionBadge = createPortraitBadge(nil, 36, 14)
    actionBadge.heart:Hide()
    actionBadge.tint:Hide()
    actionBadge.glow:Hide()
    actionBadge.region, actionBadge.layers = region, {}
    for index, spec in ipairs(layers) do actionBadge.layers[index] = spec.texture end
    actionBadge.heart, actionBadge.tint, actionBadge.glow = actionBadge.layers[2], actionBadge.layers[3],
        actionBadge.layers[4]
    actionBadge.tint:Hide()
    actionBadge.glow:SetAlpha(0)
    actionBadge.glow:SetVertexColor(1, 0.59, 0.59)
    actionBadge:SetParent(button)
    actionBadge:ClearAllPoints()
    actionBadge:SetAllPoints(region)
    actionBadge:SetFrameStrata(button:GetFrameStrata())
    actionBadge:SetFrameLevel(button:GetFrameLevel() + 5)
    fitActionBadge(actionBadge)
    return actionBadge
end

local function showActionBadge(actionBadge, shown)
    actionBadge:SetShown(shown)
    for _, texture in ipairs(actionBadge.layers) do
        if texture ~= actionBadge.tint or not shown then texture:SetShown(shown) end
    end
    if shown then fitActionBadge(actionBadge) end
    -- Hide the macro name under the icon while it shows the heart; restore it for other actions.
    local button = actionBadge:GetParent()
    local name = button.Name or (button.GetName and _G[(button:GetName() or "") .. "Name"])
    if name and name.SetAlpha then name:SetAlpha(shown and 0 or 1) end
end

local function refreshActionBadges()
    local macroIndex = GetMacroIndexByName and GetMacroIndexByName(MACRO_NAME) or 0
    wipe(actionButtons)
    if macroIndex and macroIndex > 0 then
        for _, prefix in ipairs(ACTION_BARS) do
            for index = 1, 12 do
                local button = _G[prefix .. index]
                local action = button and button:IsVisible() and buttonAction(button)
                if action and holdsHypeRaidMacro(action, macroIndex) then
                    actionButtons[button] = true
                end
            end
        end
    end
    local bpm, age, stale = addon.getLocalDisplayBpm()
    local present = false
    for button in pairs(actionButtons) do
        local actionBadge = actionBadges[button]
        -- New layers are only added to a button out of combat.
        if not actionBadge and not InCombatLockdown() then
            actionBadge = createActionBadge(button)
            actionBadges[button] = actionBadge
        end
        if actionBadge then
            present = true
            showActionBadge(actionBadge, true)
            setBadgeValue(actionBadge, bpm, addon.getLocalHistory(), age, stale)
        end
    end
    for button, actionBadge in pairs(actionBadges) do
        if not actionButtons[button] and actionBadge:IsShown() then showActionBadge(actionBadge, false) end
    end
    if present ~= hasActionIcon then
        hasActionIcon = present
        addon.syncFontReader()
    end
end

function addon.hasActionIcon()
    return hasActionIcon
end

-- Create the macro once, then put it on the cursor so the player can drop it on an action bar.
function addon.pickupActionIcon()
    if InCombatLockdown() then
        print(ADDON_TITLE .. ": Leave combat to pick up the action bar icon.")
        return
    end
    local index = GetMacroIndexByName(MACRO_NAME)
    if not index or index == 0 then
        local accountMacros, characterMacros = GetNumMacros()
        local perCharacter = accountMacros >= (MAX_ACCOUNT_MACROS or 120)
        if perCharacter and characterMacros >= (MAX_CHARACTER_MACROS or 18) then
            print(ADDON_TITLE .. ": Your macro slots are full. Delete a macro to add the action bar icon.")
            return
        end
        for _, icon in ipairs(MACRO_ICONS) do
            local ok, created = pcall(CreateMacro, MACRO_NAME, icon, MACRO_BODY, perCharacter or nil)
            if ok and created and created > 0 then
                index = created
                break
            end
        end
    end
    if not index or index == 0 then
        print(ADDON_TITLE .. ": Could not create the action bar icon macro.")
        return
    end
    PickupMacro(index)
    print(ADDON_TITLE .. ": Drop the heart on an action bar. Remove it like any other action.")
end

local actionListener = CreateFrame("Frame")
for _, event in ipairs({ "ACTIONBAR_SLOT_CHANGED", "ACTIONBAR_PAGE_CHANGED", "UPDATE_BONUS_ACTIONBAR",
    "UPDATE_MACROS", "PLAYER_ENTERING_WORLD" }) do
    pcall(actionListener.RegisterEvent, actionListener, event)
end
actionListener:SetScript("OnEvent", function()
    if initialized then refreshActionBadges() end
end)

function addon.isPortraitEnabled()
    return settings.portrait
end

function addon.needsFightPulse()
    return settings.partyMeter or settings.recapMode ~= "off"
end

function addon.refreshUI()
    local inGroup, sharing, canTest, groupStatus, fontStatus = addon.getGroupState()
    if options:IsShown() then
        share:SetChecked(sharing)
        portraitOption:SetChecked(settings.portrait)
        meterOption:SetChecked(settings.partyMeter)
        groupPortraitOption:SetChecked(settings.groupPortraits)
        graphOption:SetChecked(settings.meterGraph)
        zoneOption:SetChecked(settings.heartZones)
        recapOption:SetText(recapLabels[settings.recapMode])
        test:SetEnabled(inGroup and canTest)
        status:SetText(fontStatus and (groupStatus .. "\n" .. fontStatus) or groupStatus)
    end
    refreshPortrait()
    refreshActionBadges()
    refreshGroupPortraits(inGroup)
    refreshMeter(inGroup)
    refreshFightDetails()
end

function addon.initializeUI()
    if initialized then
        return
    end
    initialized = true
    local saved = HypeRaidSettings
    if type(saved) == "table" then
        settings.portrait = saved.portrait == true
        settings.groupPortraits = saved.groupPortraits ~= false
        settings.partyMeter = saved.partyMeter ~= false
        settings.meterGraph = saved.meterGraph == true
        settings.heartZones = saved.heartZones == true
        settings.zoneStops = validZones(saved.zoneStops) or defaultZones()
        if type(saved.recapMode) == "string" and recapLabels[saved.recapMode] then
            settings.recapMode = saved.recapMode
        end
        if type(saved.minimapAngle) == "number" and saved.minimapAngle == saved.minimapAngle then
            settings.minimapAngle = saved.minimapAngle % (2 * math.pi)
        end
        if type(saved.meterX) == "number" and type(saved.meterY) == "number" then
            settings.meterX, settings.meterY = saved.meterX, saved.meterY
            positionPanel(meter, settings.meterX, settings.meterY)
        end
        if type(saved.optionsX) == "number" and type(saved.optionsY) == "number" then
            settings.optionsX, settings.optionsY = saved.optionsX, saved.optionsY
            positionPanel(options, settings.optionsX, settings.optionsY)
        end
        if type(saved.detailsX) == "number" and type(saved.detailsY) == "number" then
            settings.detailsX, settings.detailsY = saved.detailsX, saved.detailsY
            positionPanel(details, settings.detailsX, settings.detailsY)
        end
        if type(saved.zonesX) == "number" and type(saved.zonesY) == "number" then
            settings.zonesX, settings.zonesY = saved.zonesX, saved.zonesY
            positionPanel(zoneEditor, settings.zonesX, settings.zonesY)
        end
    end
    HypeRaidSettings = settings
    if placeMinimapIcon then
        placeMinimapIcon()
    end
    C_Timer.NewTicker(1, addon.refreshUI)
end

function addon.toggleSettings()
    options:SetShown(not options:IsShown())
    addon.refreshUI()
end
