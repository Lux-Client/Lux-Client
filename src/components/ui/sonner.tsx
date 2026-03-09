import React from 'react';
import { Toaster as Sonner } from 'sonner';

function Toaster(props: React.ComponentProps<typeof Sonner>) {
    return (
        <Sonner
            expand
            position="bottom-right"
            visibleToasts={4}
            toastOptions={{
                classNames: {
                    toast: 'lux-sonner-toast',
                    title: 'lux-sonner-title',
                    description: 'lux-sonner-description',
                    success: 'lux-sonner-success',
                    error: 'lux-sonner-error',
                    info: 'lux-sonner-info',
                    warning: 'lux-sonner-warning',
                    actionButton: 'lux-sonner-action',
                    cancelButton: 'lux-sonner-cancel'
                }
            }}
            {...props}
        />
    );
}

export { Toaster };
