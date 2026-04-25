import React from 'react';

function ColorPicker({ label, value, onChange }) {
    return (
        <div className="flex items-center justify-between group flex-wrap gap-2">
            <label className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors min-w-0 break-words">
                {label}
            </label>
            <div className="relative">
                <input
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-stroke hover:border-primary/50 transition-all"
                    style={{
                        background: value,
                        WebkitAppearance: 'none',
                        MozAppearance: 'none',
                        appearance: 'none'
                    }}
                />
            </div>
        </div>
    );
}

export default ColorPicker;