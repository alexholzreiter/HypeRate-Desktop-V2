local _, addon = ...

local function measure(meter, text)
    meter:SetText(text .. "~")
    return meter:GetStringWidth()
end

function addon.readFontDigits(meter, count)
    local baseline = measure(meter, "A")
    local advance = measure(meter, "AA") - baseline
    local marker = measure(meter, "B") - baseline
    if advance <= 0 or math.abs(marker / advance - 2) > 0.25 then
        return nil, ("Marker mismatch (A %.1f, B %.1f)"):format(advance, marker)
    end

    local digits = {}
    for index = 1, count do
        local glyph = string.char(66 + index)
        local value = (measure(meter, glyph) - baseline) * 8 / marker
        local digit = math.floor(value + 0.5)
        if digit < 0 or digit > 9 or math.abs(value - digit) > 0.4 then
            return nil, ("Glyph %s width mismatch (%.2f)"):format(glyph, value)
        end
        digits[index] = digit
    end
    return digits
end
