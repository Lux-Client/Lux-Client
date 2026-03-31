import React from 'react';
import { useExtensions } from '../../context/ExtensionContext';

class ExtensionErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error("Extension Slot Error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return <div className="text-red-500 text-xs p-2 bg-red-500/10 rounded">Extension Error</div>;
        }

        return this.props.children;
    }
}

const ExtensionSlot = ({ name, className, context }: { name: string; className?: string; context?: any }) => {
    const { getViews } = useExtensions();
    const views = getViews(name);

    if (views.length === 0) return null;

    return (
        <div className={className}>
            {views.map(view => {
                const Component = view.component;
                return (
                    <ExtensionErrorBoundary key={view.id}>
                        <Component context={context} api={view.api} />
                    </ExtensionErrorBoundary>
                );
            })}
        </div>
    );
};
export default ExtensionSlot;