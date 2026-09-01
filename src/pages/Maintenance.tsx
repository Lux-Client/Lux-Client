import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wrench, Home } from 'lucide-react';

import { Button } from '../components/ui/button';

type Props = {
    onBackHome?: () => void;
};

export default function Maintenance({ onBackHome }: Props) {
    const { t } = useTranslation();

    return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
            <div className="max-w-md text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                    <Wrench className="h-7 w-7 text-primary" />
                </div>

                <h1 className="mt-5 text-xl font-semibold text-foreground">
                    {t('common.maintenance_title', 'Under Maintenance')}
                </h1>

                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t('common.maintenance_description',
                        'This tab is currently unavailable, it will be added in a future update.')}
                </p>

                {onBackHome && (
                    <Button className="mt-6" variant="outline" size="sm" onClick={onBackHome}>
                        <Home className="h-4 w-4" />
                        <span>{t('common.maintenance_back_home', 'Back to homepage')}</span>
                    </Button>
                )}
            </div>
        </div>
    );
}
