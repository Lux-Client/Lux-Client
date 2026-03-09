import React, { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

function Login({ onLoginSuccess, onGuestMode }) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await window.electronAPI.login();
            if (result.success) {
                onLoginSuccess(result.profile);
            } else {
                setError(result.error || t('login.failed'));
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-screen w-screen items-center justify-center overflow-hidden bg-background px-6 py-10">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="relative w-full max-w-md">
                <Card className="overflow-hidden border-border/70 bg-card/90 shadow-2xl backdrop-blur-xl">
                    <CardContent className="p-6 sm:p-8">
                        <div className="mb-8 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium uppercase tracking-[0.22em] text-muted-foreground">Lux</p>
                                <h2 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{t('login.title')}</h2>
                            </div>
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-background/60 text-primary shadow-sm">
                                <ShieldCheck className="h-5 w-5" />
                            </div>
                        </div>

                        {error && (
                            <div className="mb-6 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="space-y-3">
                            <Button
                                onClick={handleLogin}
                                disabled={loading}
                                size="lg"
                                className="h-12 w-full justify-between rounded-xl px-4 text-sm font-semibold"
                            >
                                <span>{loading ? t('login.logging_in') : t('login.sign_in_button')}</span>
                                <ArrowRight className="h-4 w-4" />
                            </Button>

                            <Button
                                onClick={onGuestMode}
                                variant="outline"
                                size="lg"
                                className="h-12 w-full rounded-xl border-border/70 bg-background/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                            >
                                Guest Mode
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default Login;
