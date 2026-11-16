local _, addon = ...
local ADDON_TITLE = addon.title
local LOGO = "Interface\\AddOns\\HypeRaid\\HypeRaidLogo"
local HEART = "Interface\\AddOns\\HypeRaid\\HeartBadge"
local WHITE = "Interface\\Buttons\\WHITE8X8"
local ROW_HEIGHT, VISIBLE_ROWS = 21, 6
local GRAPH_WIDTH, GRAPH_HEIGHT = 88, 15
local settings = { portrait = false, groupPortraits = true, partyMeter = true, meterGraph = false, minimapAngle = 3.85 }
local initialized = false

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

local options = panel("HypeRaidSettingsFrame", 274, 262)
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

local status = options:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
status:SetPoint("TOPLEFT", 16, -181)
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
    addon.refreshUI()
end)
makeDraggable(meter, meterHeader, "meterX", "meterY")

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
    local graph = CreateFrame("Frame", nil, bar)
    graph:SetSize(GRAPH_WIDTH, GRAPH_HEIGHT)
    graph:SetPoint("RIGHT", bpm, "LEFT", -8, 0)
    graph.segments = {}
    graph.dot = graph:CreateTexture(nil, "OVERLAY")
    graph.dot:SetSize(3, 3)
    graph:Hide()
    local name = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    name:SetPoint("LEFT", 6, 0)
    name:SetPoint("RIGHT", bpm, "LEFT", -8, 0)
    name:SetJustifyH("LEFT")
    name:SetWordWrap(false)
    bar.bpm, bar.name, bar.graph = bpm, name, graph
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
    local previousX, previousY
    for index, sample in ipairs(history) do
        local x = GRAPH_WIDTH - 2 - (latest - sample.time) / addon.chartSeconds * (GRAPH_WIDTH - 4)
        local y = GRAPH_HEIGHT / 2 + (sample.bpm - middle) / range * (GRAPH_HEIGHT - 4)
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
end

local function createPortraitBadge(name, size, fontSize)
    local badge = CreateFrame("Frame", name, UIParent)
    badge:SetSize(size, size)
    badge:SetFrameStrata("MEDIUM")
    badge:Hide()
    local heart = badge:CreateTexture(nil, "ARTWORK")
    heart:SetAllPoints()
    heart:SetTexture(HEART)
    local pulse = badge:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    pulse:SetPoint("CENTER")
    local font = pulse:GetFont()
    if font then
        pulse:SetFont(font, fontSize, "OUTLINE")
    end
    pulse:SetTextColor(1, 0.96, 0.84)
    badge.pulse = pulse
    return badge
end

local function showPortraitBadge(badge, frame, anchor, corner, x, y, bpm)
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
    badge.pulse:SetText(bpm and tostring(bpm) or "--")
    badge:Show()
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
    local bpm = addon.getLocalBpm()
    if portrait then
        showPortraitBadge(badge, PlayerFrame, portrait, "TOPLEFT", 5, -5, bpm)
    else
        showPortraitBadge(badge, PlayerFrame, PlayerFrame, "TOPLEFT", 17, -9, bpm)
    end
end

local function refreshSharedBadge(badge, frame, portrait, unit, corner, x)
    local bpm = portrait and (not portrait.IsVisible or portrait:IsVisible()) and addon.getSharedBpm(unit)
    if bpm then
        showPortraitBadge(badge, frame, portrait, corner, x, -5, bpm)
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

function addon.isPortraitEnabled()
    return settings.portrait
end

function addon.refreshUI()
    local inGroup, sharing, canTest, groupStatus, fontStatus = addon.getGroupState()
    if options:IsShown() then
        share:SetChecked(sharing)
        portraitOption:SetChecked(settings.portrait)
        meterOption:SetChecked(settings.partyMeter)
        groupPortraitOption:SetChecked(settings.groupPortraits)
        graphOption:SetChecked(settings.meterGraph)
        test:SetEnabled(inGroup and canTest)
        status:SetText(fontStatus and (groupStatus .. "\n" .. fontStatus) or groupStatus)
    end
    refreshPortrait()
    refreshGroupPortraits(inGroup)
    refreshMeter(inGroup)
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
