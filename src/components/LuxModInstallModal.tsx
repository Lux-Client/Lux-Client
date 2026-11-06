import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { useNotification } from '../context/NotificationContext';
import { installLuxClientMod, isLuxModSupported, useLuxModVersions } from '../utils/luxMod';

type Props = {
    open: boolean;
    onClose: () => void;
    instances: any[];
};

// Pick any instance and put the Lux Client mod on it, after checking it fits.
function LuxModInstallModal({ open, onClose, instances }: Props) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const luxModVersions = useLuxModVersions();
    const [selectedName, setSelectedName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setSelectedName('');
            setError('');
        }
    }, [open]);

    const list = Array.isArray(instances) ? instances : [];
    const selected = list.find((instance) => instance?.name === selectedName) || null;

    const fail = (message: string) => {
        setError(message);
        addNotification(message, 'error');
    };

    const handleInstall = async () => {
        if (!selected || busy) return;
        setBusy(true);
        setError('');
        try {
            const notCompatible = t('lux_mod.picker.not_compatible', '{{name}} is not compatible with Lux Client. It needs Fabric and one of these versions: {{versions}}.', {
                name: selected.name,
                versions: luxModVersions.join(', ')
            });

            const status = await window.electronAPI.getLuxModStatus(selected.name, { force: true });
            if (!status?.success) {
                fail(t('lux_mod.install_failed', 'Could not install Lux Client: {{error}}', { error: status?.error || 'unknown error' }));
                return;
            }
            if (!status.supported) {
                fail(notCompatible);
                return;
            }
            if (!status.available) {
                fail(t('lux_mod.picker.no_release', 'There is no Lux Client release for Minecraft {{version}} yet.', { version: status.mcVersion }));
                return;
            }
            if (status.installed && !status.disabled && !status.updateAvailable) {
                addNotification(t('lux_mod.picker.already_installed', 'Lux Client is already installed in {{name}}.', { name: selected.name }), 'info');
                onClose();
                return;
            }

            const res = await installLuxClientMod(selected.name, status.mcVersion);
            if (res?.success) {
                addNotification(t('lux_mod.picker.installed', 'Lux Client installed in {{name}}.', { name: selected.name }), 'success');
                onClose();
            } else {
                fail(t('lux_mod.install_failed', 'Could not install Lux Client: {{error}}', { error: res?.error || 'unknown error' }));
            }
        } catch (err) {
            fail(t('lux_mod.install_failed', 'Could not install Lux Client: {{error}}', { error: err?.message || 'unknown error' }));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('lux_mod.picker.title', 'Install Lux Client')}</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                    {t('lux_mod.picker.desc', 'Choose an instance to install the Lux Client mod into.')}
                </p>

                <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                    {list.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                            {t('lux_mod.picker.empty', 'No instances yet.')}
                        </div>
                    ) : (
                        list.map((instance) => {
                            const compatible = isLuxModSupported(luxModVersions, instance?.version, instance?.loader);
                            const isSelected = instance?.name === selectedName;
                            return (
                                <button
                                    key={instance.name}
                                    type="button"
                                    onClick={() => { setSelectedName(instance.name); setError(''); }}
                                    className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${isSelected
                                        ? 'border-primary bg-primary/10'
                                        : 'border-border bg-muted hover:border-primary/50'}`}
                                >
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-foreground">{instance.name}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            {(instance.loader || 'Vanilla')} · {instance.version}
                                        </div>
                                    </div>
                                    <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${compatible
                                        ? 'bg-primary/15 text-primary'
                                        : 'bg-muted text-muted-foreground border border-border'}`}
                                    >
                                        {compatible
                                            ? t('lux_mod.picker.compatible', 'Compatible')
                                            : t('lux_mod.picker.incompatible', 'Not compatible')}
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>

                {error && (
                    <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {error}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
                        {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button type="button" size="sm" disabled={!selected || busy} onClick={handleInstall} className="gap-1.5">
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {busy ? t('common.installing', 'Installing...') : t('lux_mod.install', 'Install Lux Client')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default LuxModInstallModal;
