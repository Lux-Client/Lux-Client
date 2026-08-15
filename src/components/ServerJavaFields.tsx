import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const CUSTOM = '__custom__';

// Shared Java runtime + JVM args editor used both in the server-wide defaults and in the
// per-server settings. `javaPath` empty means "automatic": the backend then honors the global
// Lux runtime and auto-detects a compatible one by Minecraft version.
function ServerJavaFields({
    runtimes = [],
    javaPath = '',
    javaArgs = '',
    onJavaPathChange,
    onJavaArgsChange,
    autoLabel,
    argsPlaceholder = '-XX:+UseG1GC -Dfile.encoding=UTF-8'
}: {
    runtimes?: any[];
    javaPath?: string;
    javaArgs?: string;
    onJavaPathChange: (value: string) => void;
    onJavaArgsChange: (value: string) => void;
    autoLabel?: string;
    argsPlaceholder?: string;
}) {
    const { t } = useTranslation();

    const matchesRuntime = useMemo(
        () => runtimes.some((r) => r.path === javaPath),
        [runtimes, javaPath]
    );
    // A non-empty path that isn't one of the detected runtimes is a manually entered path.
    const isCustom = !!javaPath && !matchesRuntime;
    const selectValue = javaPath === '' ? '' : (isCustom ? CUSTOM : javaPath);

    const inputClass = 'w-full bg-background border border-border rounded-xl px-4 py-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-colors';
    const labelClass = 'block text-muted-foreground text-sm font-bold mb-2 uppercase tracking-wide';

    return (
        <div className="grid grid-cols-1 gap-4">
            <div>
                <label className={labelClass}>{t('server.java.runtime_label', 'Java Runtime')}</label>
                <select
                    value={selectValue}
                    onChange={(e) => {
                        const v = e.target.value;
                        if (v === CUSTOM) onJavaPathChange(javaPath || ' ');
                        else onJavaPathChange(v);
                    }}
                    className={inputClass}
                >
                    <option value="">{autoLabel || t('server.java.automatic', 'Automatic (recommended)')}</option>
                    {runtimes.map((r) => (
                        <option key={r.path} value={r.path}>
                            {r.name}{r.type === 'system' ? ` · ${t('server.java.system', 'system')}` : ''}
                        </option>
                    ))}
                    <option value={CUSTOM}>{t('server.java.custom', 'Custom path…')}</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1.5">
                    {t('server.java.runtime_hint', 'Automatic uses your global Lux Java setting and picks a build matching the server version.')}
                </p>
            </div>

            {isCustom && (
                <div>
                    <label className={labelClass}>{t('server.java.custom_path_label', 'Java Path')}</label>
                    <input
                        type="text"
                        value={javaPath.trim()}
                        onChange={(e) => onJavaPathChange(e.target.value)}
                        placeholder={process.platform === 'win32' ? 'C:\\\\Program Files\\\\Java\\\\jdk-21\\\\bin\\\\java.exe' : '/usr/lib/jvm/jdk-21/bin/java'}
                        className={inputClass}
                        spellCheck={false}
                    />
                </div>
            )}

            <div>
                <label className={labelClass}>{t('server.java.args_label', 'JVM Arguments')}</label>
                <input
                    type="text"
                    value={javaArgs}
                    onChange={(e) => onJavaArgsChange(e.target.value)}
                    placeholder={argsPlaceholder}
                    className={inputClass}
                    spellCheck={false}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                    {t('server.java.args_hint', 'Extra flags passed before -jar. Leave empty to just use the memory setting.')}
                </p>
            </div>
        </div>
    );
}

export default ServerJavaFields;
