import React from 'react';
import { LayoutGrid, PencilLine, Sparkles, Globe, Package, SunMedium, Grip } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';

type DashboardSection = {
    id: string;
    visible?: boolean;
    width?: number;
};

type DashboardSettings = {
    welcomeMessage?: string;
    layout?: DashboardSection[];
};

type DashboardCustomizerProps = {
    open: boolean;
    settings: DashboardSettings;
    onUpdate: (settings: DashboardSettings) => void;
    onClose: () => void;
    onEnterEditor: () => void;
    isEditing?: boolean;
};

const sections = [
    {
        id: 'recent-instances',
        title: 'Jump back in',
        description: 'Show your latest played instances at the top of the dashboard.',
        icon: Sparkles,
    },
    {
        id: 'recent-worlds',
        title: 'Recent Worlds',
        description: 'Keep quick access to the last worlds you opened.',
        icon: Globe,
    },
    {
        id: 'modpacks',
        title: 'Discover Modpacks',
        description: 'Display curated modpack recommendations on the home page.',
        icon: Package,
    },
    {
        id: 'mod-of-the-day',
        title: 'Mod of the Day',
        description: 'Highlight a featured mod to explore something new.',
        icon: SunMedium,
    },
];

function DashboardCustomizer({ open, settings, onUpdate, onClose, onEnterEditor, isEditing }: DashboardCustomizerProps) {
    const handleChange = (key: keyof DashboardSettings, value: DashboardSettings[keyof DashboardSettings]) => {
        onUpdate({
            ...settings,
            [key]: value
        });
    };

    const toggleSection = (id: string) => {
        const newLayout = (settings.layout || []).map(section => {
            if (section.id === id) {
                return { ...section, visible: !section.visible };
            }
            return section;
        });
        handleChange('layout', newLayout);
    };

    const isVisible = (id: string) => {
        return settings.layout?.find(s => s.id === id)?.visible !== false;
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
                <DialogContent animationVariant="zoom" className="max-w-xl overflow-hidden border-stroke bg-surface p-0 shadow-2xl duration-150">
                    <DialogHeader className="gap-0 border-b border-stroke bg-muted/30 px-6 py-5 text-left">
                        <div className="flex items-center gap-4 pr-8">
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-stroke bg-canvas text-primary shadow-sm">
                                <LayoutGrid />
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-center">
                                <DialogTitle className="text-xl font-semibold">Customize Dashboard</DialogTitle>
                            </div>
                        </div>
                    </DialogHeader>

                <div className="max-h-[66vh] overflow-y-auto px-6 py-4">
                    <div className="flex flex-col gap-5">
                        <Card className="overflow-hidden border-stroke bg-canvas/80">
                            <CardHeader className="pb-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                        <PencilLine />
                                    </div>
                                    <div className="flex-1">
                                        <CardTitle className="text-base">Visual Layout Editor</CardTitle>
                                        <CardDescription className="mt-1">
                                            Rearrange and resize dashboard sections with the visual editor.
                                        </CardDescription>
                                    </div>
                                    {isEditing && (
                                        <div className="rounded-full border border-stroke bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                            Active
                                        </div>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <Button onClick={onEnterEditor} className="w-full justify-center gap-2 sm:w-auto">
                                    <Grip data-icon="inline-start" />
                                    Open Visual Editor
                                </Button>
                            </CardContent>
                        </Card>

                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <h3 className="text-sm font-medium text-foreground">Welcome Message</h3>
                                <p className="text-sm text-muted-foreground">
                                    This text appears at the top of the dashboard.
                                </p>
                            </div>
                            <Input
                                type="text"
                                value={settings.welcomeMessage || 'Welcome back!'}
                                onChange={(e) => handleChange('welcomeMessage', e.target.value)}
                                placeholder="Welcome back!"
                                className="h-11 rounded-xl bg-canvas"
                            />
                        </div>

                        <Separator />

                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <h3 className="text-sm font-medium text-foreground">Toggle Sections</h3>
                                <p className="text-sm text-muted-foreground">
                                    Choose which cards stay visible on the home page.
                                </p>
                            </div>

                            <div className="flex flex-col gap-2">
                                {sections.map(({ id, title, description, icon: Icon }) => (
                                    <Card key={id} className="border-stroke bg-canvas/70 shadow-sm">
                                        <CardContent className="flex items-center justify-between gap-3 p-3">
                                            <div className="flex min-w-0 items-center gap-3">
                                                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                                    <Icon />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-medium text-foreground">{title}</p>
                                                    <p className="mt-0.5 pr-2 text-sm leading-5 text-muted-foreground">{description}</p>
                                                </div>
                                            </div>
                                            <Switch checked={isVisible(id)} onCheckedChange={() => toggleSection(id)} />
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="border-t border-stroke bg-muted/20 px-6 py-4 sm:justify-end">
                    <Button onClick={onClose} className="min-w-24">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default DashboardCustomizer;
