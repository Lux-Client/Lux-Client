import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Link2, Trash2 } from 'lucide-react';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger
} from './ui/context-menu';
import { useNotification } from '../context/NotificationContext';
import { getProjectLink, getProjectPlatformLabel } from '../utils/projectLinks';
import { copyTextToClipboard } from '../utils/clipboard';

interface ProjectContextMenuProps {
    /** Modrinth/CurseForge project, search hit or installed content entry. */
    project: any;
    /** Optional label shown as the menu heading, defaults to the project title. */
    title?: string;
    /** When given, the menu offers a delete entry that calls this. */
    onDelete?: () => void;
    /** Label for the delete entry, e.g. "Delete Mod". */
    deleteLabel?: string;
    children: React.ReactElement;
}

/**
 * Adds a right-click menu to any element that represents a Modrinth or CurseForge project:
 * "Open in browser" and "Copy link", plus an optional delete entry. Renders the child
 * untouched when there is neither a usable link nor a delete action.
 */
const ProjectContextMenu: React.FC<ProjectContextMenuProps> = ({ project, title, onDelete, deleteLabel, children }) => {
    const { t } = useTranslation();
    const { addNotification } = useNotification();

    const link = React.useMemo(() => getProjectLink(project), [project]);
    if (!link && !onDelete) return children;

    const platformLabel = link ? getProjectPlatformLabel(link.platform) : '';
    const headingLabel = title || project?.title || project?.name || platformLabel;

    const handleOpen = async () => {
        if (!link) return;

        try {
            const res = await window.electronAPI?.openExternal(link.url);
            if (res && res.success === false) {
                addNotification(t('project_menu.open_failed', 'Could not open the project page.'), 'error');
            }
        } catch (e) {
            console.error('[ProjectContextMenu] Failed to open project', e);
            addNotification(t('project_menu.open_failed', 'Could not open the project page.'), 'error');
        }
    };

    const handleCopy = async () => {
        if (!link) return;

        const copied = await copyTextToClipboard(link.url);
        if (copied) {
            addNotification(t('project_menu.copied', 'Project link copied to clipboard!'), 'success');
        } else {
            addNotification(t('project_menu.copy_failed', 'Could not copy the project link.'), 'error');
        }
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-60">
                <ContextMenuLabel className="truncate text-xs font-bold">
                    {headingLabel}
                </ContextMenuLabel>
                <ContextMenuSeparator />

                {link && (
                    <>
                        <ContextMenuItem onSelect={handleOpen}>
                            <ExternalLink className="h-4 w-4" />
                            {t('project_menu.open_in_browser', 'Open in browser')}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={handleCopy}>
                            <Link2 className="h-4 w-4" />
                            {t('project_menu.copy_link', 'Copy link')}
                        </ContextMenuItem>
                    </>
                )}

                {onDelete && (
                    <>
                        {link && <ContextMenuSeparator />}
                        <ContextMenuItem
                            onSelect={onDelete}
                            className="text-red-400 focus:bg-red-500/15 focus:text-red-300"
                        >
                            <Trash2 className="h-4 w-4" />
                            {deleteLabel || t('project_menu.delete', 'Delete')}
                        </ContextMenuItem>
                    </>
                )}

                {link && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                            {platformLabel}
                        </ContextMenuLabel>
                    </>
                )}
            </ContextMenuContent>
        </ContextMenu>
    );
};

export default ProjectContextMenu;
