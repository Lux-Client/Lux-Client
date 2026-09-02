import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { NotificationProvider } from './context/NotificationContext'
import { LuxAccountProvider } from './context/LuxAccountContext'
import { LuxSyncAutoProvider } from './context/LuxSyncContext'
import './index.css'
import './i18n';
window.React = React;
(window as any).ReactDOM = ReactDOM;
ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <NotificationProvider>
            <LuxAccountProvider>
                <LuxSyncAutoProvider>
                    <App />
                </LuxSyncAutoProvider>
            </LuxAccountProvider>
        </NotificationProvider>
    </React.StrictMode>,
)