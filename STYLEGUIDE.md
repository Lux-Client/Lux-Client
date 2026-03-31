# Style Guide

This document outlines the coding conventions and best practices for the Lux client project.

## General

- **Language**: TypeScript is used throughout the frontend (`src/`) and backend (`backend/`, `electron/`)
- **No comments**: Do not add comments unless explicitly requested
- **ESLint**: All code must pass `npm run lint`
- **TypeScript**: All code must pass `npm run typecheck`

## File Naming

- React components: `PascalCase.tsx` (e.g., `SettingsPage.tsx`)
- Utilities and hooks: `camelCase.ts` (e.g., `useSettings.ts`)
- Config files: `camelCase.js` or `kebab-case.js`
- Test files: `*.test.ts` or `*.spec.ts`

## React Components

### Component Structure

```tsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
    Save,
    Download,
    RefreshCw,
} from 'lucide-react';

function MyComponent({ initialValue, onSave }) {
    const { t } = useTranslation();
    const [value, setValue] = useState(initialValue);

    useEffect(() => {
        // effect logic
    }, []);

    const handleChange = (newValue) => {
        setValue(newValue);
        onSave?.(newValue);
    };

    return (
        <div className="flex items-center gap-4">
            <Button onClick={() => handleChange('new')}>
                <Save className="h-4 w-4 mr-2" />
                {t('action.save')}
            </Button>
        </div>
    );
}

export default MyComponent;
```

### Hooks

- Use functional components with hooks
- Prefer `useState` and `useEffect` over class components
- Extract reusable logic into custom hooks (`use*`)

### State Management

- Use React Context for global state (see `NotificationContext`)
- Use `useState` for local component state
- Use `window.electronAPI` for IPC communication with the backend

## TypeScript

### Interfaces and Types

```typescript
interface Settings {
    enableModrinthPackSupport: boolean;
    enableDiscordRPC: boolean;
    theme: ThemeSettings;
}

interface ThemeSettings {
    primaryColor: string;
    backgroundColor: string;
}
```

### Avoid `any`

- Use `any` sparingly and only when absolutely necessary
- Prefer `unknown` and type narrowing when possible
- ESLint rule `@typescript-eslint/no-explicit-any` is currently off, but avoid using it

## Settings System

### Backend (Node.js)

Settings are stored in `backend/handlers/settings.js`:

```javascript
const defaultSettings = {
    enableModrinthPackSupport: true,
    // other settings...
};
```

### Frontend (React)

Settings state in components:

```typescript
const [settings, setSettings] = useState({
    enableModrinthPackSupport: true,
});
```

### Reading Settings

```typescript
const loadSettings = async () => {
    const res = await window.electronAPI.getSettings();
    if (res.success) {
        setSettings(res.settings);
    }
};
```

### Writing Settings

```typescript
const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    window.electronAPI.saveSettings(settings);
};
```

### Listening for Updates

```typescript
useEffect(() => {
    const cleanup = window.electronAPI.onSettingsUpdated?.((newSettings) => {
        setSettings(newSettings);
    });
    return () => cleanup?.();
}, []);
```

## Naming Conventions

### Variables and Functions

- Use `camelCase` for variables and functions
- Use descriptive names that convey purpose

```typescript
// Good
const enableModrinthPackSupport = true;
const handleSaveSettings = async () => {};

// Avoid
const x = true;
const fn = () => {};
```

### Settings Keys

- Settings keys should be descriptive and follow camelCase
- Group related settings under nested objects when appropriate

```typescript
// Good
enableModrinthPackSupport
enableDiscordRPC
cloudBackupSettings.enabled

// Avoid
modrinth_support
disc_rpc
cloud
```

### Components

- Use `PascalCase` for component names
- Export as default when file contains only one component

```typescript
function SettingsPage() { }
export default SettingsPage;
```

### Boolean Settings

- Use positive/progressive naming (enable, show, allow)
- Avoid negated names (disable, hide, disallow)

```typescript
// Good
enableModrinthPackSupport
showDisabledFeatures
allowAutoBackup

// Avoid
disableModrinthPackSupport
hideFeatures
disallowAutoBackup
```

## CSS and Styling

### Tailwind CSS

- Use Tailwind CSS utility classes for styling
- Prefer inline classes over separate CSS files
- Use `cn()` utility for conditional classes

```tsx
import { cn } from '../lib/utils';

<div className={cn(
    "flex items-center gap-4 p-4",
    isActive && "bg-primary/10",
    className
)}>
```

### Class Organization

Order Tailwind classes by category:
1. Layout (`flex`, `grid`, `block`)
2. Spacing (`p-4`, `m-2`, `gap-4`)
3. Sizing (`w-full`, `h-12`)
4. Colors (`bg-primary`, `text-foreground`)
5. Typography (`text-sm`, `font-medium`)
6. Effects (`shadow-md`, `rounded-lg`)

## i18n (Internationalization)

### Translation Keys

Organize keys by feature/page:

```json
{
    "settings": {
        "title": "Settings",
        "integration": {
            "title": "Launcher Integration",
            "modrinth_support": "Modrinth Modpacks",
            "modrinth_support_desc": "Enable searching and installing Modrinth modpacks."
        }
    }
}
```

### Usage

```tsx
const { t } = useTranslation();

<span>{t('settings.integration.modrinth_support')}</span>
```

## Icons

- Use `lucide-react` for most icons
- Import icons at the top of the file
- Use consistent sizes (typically `h-4 w-4` or `h-5 w-5`)

```tsx
import { Save, Download, RefreshCw } from 'lucide-react';

<Save className="h-4 w-4" />
```

## API and IPC

### Electron IPC

IPC calls go through `window.electronAPI`:

```typescript
// Read
const res = await window.electronAPI.getSettings();

// Write
await window.electronAPI.saveSettings(settings);

// Listen for updates
window.electronAPI.onSettingsUpdated((newSettings) => { });
```

### Backend Handlers

Backend handlers are in `backend/handlers/`:

```javascript
ipcMain.handle('settings:get', async () => {
    // handler logic
    return { success: true, settings };
});
```

## Best Practices

1. **Keep components small**: Extract logic into hooks or sub-components
2. **Handle loading states**: Show appropriate loading indicators
3. **Handle errors**: Use try/catch and show notifications
4. **Cleanup effects**: Always return cleanup functions from useEffect
5. **Use fragments**: Group JSX elements with `<>` instead of `<div>` when possible
6. **Optimize re-renders**: Use `useCallback` and `useMemo` for expensive operations

## Running Checks

```bash
# Lint
npm run lint

# Type check
npm run typecheck

# Both
npm run lint && npm run typecheck
```
