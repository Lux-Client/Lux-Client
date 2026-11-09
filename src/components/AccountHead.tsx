import React, { useEffect, useState } from 'react';
import PlayerHead from './PlayerHead';
import { cacheAccountSkin, getCachedAccountSkin } from '../utils/accountSkinCache';

const lookedUp = new Set<string>();

// Head of a saved account: uses the remembered skin, and looks it up once per
// session from Mojang when the account was never active on this launcher.
const AccountHead = ({ uuid, name, size, className }: { uuid?: string; name?: string; size?: number; className?: string }) => {
    const [skin, setSkin] = useState<string | undefined>(() => getCachedAccountSkin(uuid));

    useEffect(() => {
        const cached = getCachedAccountSkin(uuid);
        setSkin(cached);
        const key = String(uuid || '').replace(/-/g, '').toLowerCase();
        if (!key || lookedUp.has(key) || typeof window.electronAPI?.getSkinByUuid !== 'function') return;
        lookedUp.add(key);

        let cancelled = false;
        window.electronAPI.getSkinByUuid(key).then((res) => {
            if (!res?.success || !res.url) return;
            cacheAccountSkin(key, res.url);
            if (!cancelled) setSkin(res.url);
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [uuid]);

    return <PlayerHead src={skin} uuid={uuid} name={name} size={size} className={className} />;
};

export default AccountHead;
