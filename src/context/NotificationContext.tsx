import React, { createContext, useContext } from 'react';
import { toast } from 'sonner';
import { Toaster } from '../components/ui/sonner';
import { playSound } from '../lib/soundManager';

const NotificationContext = createContext<any>(null);

const notificationHandlers = {
    success: toast.success,
    error: toast.error,
    info: toast.info,
    warning: toast.warning
};

export function useNotification() {
    return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const addNotification = (message, type = 'info', duration = 3000) => {
        const showNotification = notificationHandlers[type] || toast;
        playSound(type === 'error' ? 'error' : 'notification');
        return showNotification(message, {
            duration: duration > 0 ? duration : Number.POSITIVE_INFINITY
        });
    };

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            <Toaster />
        </NotificationContext.Provider>
    );
}
