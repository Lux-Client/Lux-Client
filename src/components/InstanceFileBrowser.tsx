import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import YAML from 'js-yaml';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-properties';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import Editor from 'react-simple-code-editor';
import Dropdown from './Dropdown';
import { useNotification } from '../context/NotificationContext';

const TEXT_EXTENSIONS = [
    '.txt', '.log', '.properties', '.yml', '.yaml', '.json', '.json5', '.conf', '.cfg', '.ini',
    '.sh', '.bat', '.cmd', '.py', '.js', '.ts', '.jsx', '.tsx', '.toml', '.md', '.xml', '.csv'
];

const FORMAT_OPTIONS = [
    { value: 'plaintext', label: 'Plain Text' },
    { value: 'json', label: 'JSON' },
    { value: 'yaml', label: 'YAML' },
    { value: 'xml', label: 'XML/HTML' },
    { value: 'properties', label: 'Properties/INI' },
    { value: 'toml', label: 'TOML' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'bash', label: 'Shell/Bash' },
    { value: 'python', label: 'Python' },
    { value: 'markdown', label: 'Markdown' }
];

const FORMAT_BY_EXTENSION = [
    { exts: ['.json', '.json5'], format: 'json' },
    { exts: ['.yml', '.yaml'], format: 'yaml' },
    { exts: ['.xml', '.html', '.htm', '.svg'], format: 'xml' },
    { exts: ['.properties', '.ini', '.conf', '.cfg', '.secret'], format: 'properties' },
    { exts: ['.toml'], format: 'toml' },
    { exts: ['.js', '.cjs', '.mjs'], format: 'javascript' },
    { exts: ['.ts', '.tsx'], format: 'typescript' },
    { exts: ['.sh', '.bat', '.cmd', '.ps1'], format: 'bash' },
    { exts: ['.py'], format: 'python' },
    { exts: ['.md'], format: 'markdown' }
];

const normalizeJoin = (base: string, segment: string) => {
    const cleanBase = String(base || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const cleanSegment = String(segment || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleanBase) return cleanSegment;
    if (!cleanSegment) return cleanBase;
    return `${cleanBase}/${cleanSegment}`;
};

const inferFormatFromFilename = (fileName: string) => {
    const lower = String(fileName || '').toLowerCase();
    for (const entry of FORMAT_BY_EXTENSION) {
        if (entry.exts.some((ext) => lower.endsWith(ext))) {
            return entry.format;
        }
    }
    return 'plaintext';
};

const mapFormatToPrismLanguage = (format: string) => {
    if (format === 'xml') return 'markup';
    if (format === 'plaintext') return 'plain';
    return format;
};

const formatPreviewContent = (content: string, _effectiveFormat: string) => {
    return content;
};

const validateByFormat = (content: string, effectiveFormat: string) => {
    if (effectiveFormat === 'json') {
        try {
            JSON.parse(content);
            return { ok: true, message: 'Valid JSON' };
        } catch (e: any) {
            return { ok: false, message: e?.message || 'Invalid JSON' };
        }
    }

    if (effectiveFormat === 'yaml') {
        try {
            YAML.load(content);
            return { ok: true, message: 'Valid YAML' };
        } catch (e: any) {
            return { ok: false, message: e?.message || 'Invalid YAML' };
        }
    }

    if (effectiveFormat === 'xml') {
        try {
            const parser = new DOMParser();
            const documentNode = parser.parseFromString(content, 'application/xml');
            const errorNode = documentNode.querySelector('parsererror');
            if (errorNode) {
                return { ok: false, message: errorNode.textContent || 'Invalid XML' };
            }
            return { ok: true, message: 'Valid XML' };
        } catch (e: any) {
            return { ok: false, message: e?.message || 'Invalid XML' };
        }
    }

    if (effectiveFormat === 'properties') {
        const lines = content.split(/\r?\n/);
        const invalidLine = lines.find((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return false;
            return !trimmed.includes('=') && !trimmed.includes(':');
        });

        if (invalidLine) {
            return {
                ok: false,
                message: `Invalid properties line: ${invalidLine.slice(0, 80)}`
            };
        }

        return { ok: true, message: 'Looks valid as properties/ini' };
    }

    return { ok: true, message: 'No strict validator for this format' };
};

type SearchMatch = {
    start: number;
    end: number;
};

type EditorViewport = {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
};

const renderHighlightedText = (
    text: string,
    matches: SearchMatch[],
    activeMatchIndex: number,
    offsetRef: { current: number },
    keyPrefix: string
) => {
    const startOffset = offsetRef.current;
    const endOffset = startOffset + text.length;
    const parts: React.ReactNode[] = [];
    let cursor = 0;

    matches.forEach((match, matchIndex) => {
        if (match.end <= startOffset || match.start >= endOffset) return;

        const localStart = Math.max(0, match.start - startOffset);
        const localEnd = Math.min(text.length, match.end - startOffset);

        if (localStart > cursor) {
            parts.push(text.slice(cursor, localStart));
        }

        parts.push(
            <mark
                key={`${keyPrefix}-match-${matchIndex}`}
                className={activeMatchIndex === matchIndex ? 'bg-primary text-black rounded-sm px-0.5' : 'bg-yellow-400/35 text-inherit rounded-sm px-0.5'}
            >
                {text.slice(localStart, localEnd)}
            </mark>
        );

        cursor = localEnd;
    });

    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }

    offsetRef.current = endOffset;

    if (parts.length === 0) return text;
    if (parts.length === 1) return parts[0];
    return parts;
};

const renderPrismTokenTree = (
    token: string | Prism.Token,
    matches: SearchMatch[],
    activeMatchIndex: number,
    offsetRef: { current: number },
    keyPrefix: string
): React.ReactNode => {
    if (typeof token === 'string') {
        return renderHighlightedText(token, matches, activeMatchIndex, offsetRef, keyPrefix);
    }

    const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
    const className = ['token', token.type, ...aliases].join(' ');
    const children = Array.isArray(token.content)
        ? token.content.map((child, index) => renderPrismTokenTree(child as string | Prism.Token, matches, activeMatchIndex, offsetRef, `${keyPrefix}-${index}`))
        : renderPrismTokenTree(token.content as string | Prism.Token, matches, activeMatchIndex, offsetRef, `${keyPrefix}-content`);

    return (
        <span key={keyPrefix} className={className}>
            {children}
        </span>
    );
};

export type InstanceFileBrowserHandle = {
    saveCurrentFile: () => Promise<boolean>;
    discardUnsavedChanges: () => void;
};

type InstanceFileBrowserProps = {
    instanceName: string;
    onDirtyChange?: (dirty: boolean) => void;
};

const InstanceFileBrowser = forwardRef<InstanceFileBrowserHandle, InstanceFileBrowserProps>(function InstanceFileBrowser(
    { instanceName, onDirtyChange },
    ref
) {
    const { t } = useTranslation();
    const { addNotification } = useNotification();

    const [files, setFiles] = useState<any[]>([]);
    const [currentPath, setCurrentPath] = useState('');
    const [loading, setLoading] = useState(true);

    const [selectedFile, setSelectedFile] = useState<any>(null);
    const [editingContent, setEditingContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [selectedFormat, setSelectedFormat] = useState('plaintext');

    const [showLeaveEditorModal, setShowLeaveEditorModal] = useState(false);
    const [isSavingAndClosing, setIsSavingAndClosing] = useState(false);
    const [showSearchBar, setShowSearchBar] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeSearchMatch, setActiveSearchMatch] = useState(0);

    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    const [pendingDelete, setPendingDelete] = useState<any>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const editorShellRef = useRef<HTMLDivElement | null>(null);

    const [editorViewport, setEditorViewport] = useState<EditorViewport>({
        scrollTop: 0,
        scrollHeight: 1,
        clientHeight: 1
    });

    const getEditorTextarea = () => document.getElementById('instance-file-editor') as HTMLTextAreaElement | null;

    const hasUnsavedChanges = Boolean(selectedFile) && editingContent !== originalContent;

    const effectiveFormat = useMemo(() => {
        if (!selectedFile) return 'plaintext';
        return selectedFormat || 'plaintext';
    }, [selectedFile, selectedFormat]);

    const previewSource = useMemo(() => formatPreviewContent(editingContent, effectiveFormat), [editingContent, effectiveFormat]);

    const validationState = useMemo(() => validateByFormat(editingContent, effectiveFormat), [editingContent, effectiveFormat]);

    const searchMatches = useMemo(() => {
        const query = searchQuery.trim();
        if (!query) return [];

        const haystack = editingContent.toLowerCase();
        const needle = query.toLowerCase();
        const result: Array<{ start: number; end: number }> = [];

        let from = 0;
        while (from < haystack.length) {
            const index = haystack.indexOf(needle, from);
            if (index === -1) break;
            result.push({ start: index, end: index + needle.length });
            from = index + Math.max(needle.length, 1);
        }

        return result;
    }, [editingContent, searchQuery]);

    const searchMatchMarkers = useMemo(() => {
        const contentLength = Math.max(editingContent.length, 1);
        return searchMatches.map((match, index) => {
            const startRatio = match.start / contentLength;
            const endRatio = Math.max(match.end, match.start + 1) / contentLength;
            return {
                index,
                topPercent: Math.min(100, Math.max(0, startRatio * 100)),
                heightPercent: Math.max(0.45, (endRatio - startRatio) * 100)
            };
        });
    }, [editingContent.length, searchMatches]);

    const viewportIndicator = useMemo(() => {
        const safeScrollHeight = Math.max(editorViewport.scrollHeight, 1);
        const visibleRatio = Math.min(1, editorViewport.clientHeight / safeScrollHeight);
        const topRatio = Math.min(1, editorViewport.scrollTop / safeScrollHeight);

        return {
            topPercent: topRatio * 100,
            heightPercent: Math.max(8, visibleRatio * 100)
        };
    }, [editorViewport]);

    const highlightedNodes = useMemo(() => {
        const language = mapFormatToPrismLanguage(effectiveFormat);
        const grammar = Prism.languages[language] || Prism.languages.plain;
        const offsetRef = { current: 0 };

        try {
            const tokens = Prism.tokenize(previewSource || ' ', grammar);
            return tokens.map((token, index) => renderPrismTokenTree(token as string | Prism.Token, searchMatches, activeSearchMatch, offsetRef, `token-${index}`));
        } catch {
            const tokens = Prism.tokenize(previewSource || ' ', Prism.languages.plain);
            return tokens.map((token, index) => renderPrismTokenTree(token as string | Prism.Token, searchMatches, activeSearchMatch, offsetRef, `plain-token-${index}`));
        }
    }, [previewSource, effectiveFormat, searchMatches, activeSearchMatch]);

    useEffect(() => {
        onDirtyChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onDirtyChange]);

    useEffect(() => {
        return () => {
            onDirtyChange?.(false);
        };
    }, [onDirtyChange]);

    useEffect(() => {
        if (!showSearchBar) return;
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, [showSearchBar]);

    useEffect(() => {
        if (activeSearchMatch >= searchMatches.length) {
            setActiveSearchMatch(0);
        }
    }, [searchMatches.length, activeSearchMatch]);

    useEffect(() => {
        if (!selectedFile) return;

        const updateViewport = () => {
            const textarea = getEditorTextarea();
            if (!textarea) return;

            setEditorViewport((current) => {
                const next = {
                    scrollTop: textarea.scrollTop,
                    scrollHeight: textarea.scrollHeight || 1,
                    clientHeight: textarea.clientHeight || 1
                };

                if (
                    current.scrollTop === next.scrollTop &&
                    current.scrollHeight === next.scrollHeight &&
                    current.clientHeight === next.clientHeight
                ) {
                    return current;
                }

                return next;
            });
        };

        const bindViewportTracking = () => {
            const textarea = getEditorTextarea();
            if (!textarea) {
                requestAnimationFrame(bindViewportTracking);
                return;
            }

            updateViewport();

            textarea.addEventListener('scroll', updateViewport);

            const resizeObserver = typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => updateViewport())
                : null;

            resizeObserver?.observe(textarea);
            if (editorShellRef.current) {
                resizeObserver?.observe(editorShellRef.current);
            }

            window.addEventListener('resize', updateViewport);

            return () => {
                textarea.removeEventListener('scroll', updateViewport);
                resizeObserver?.disconnect();
                window.removeEventListener('resize', updateViewport);
            };
        };

        const cleanup = bindViewportTracking();
        return () => {
            cleanup?.();
        };
    }, [selectedFile, editingContent, showSearchBar]);

    const loadFiles = async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.listInstanceFiles(instanceName, currentPath);
            if (!res?.success) {
                addNotification(`${t('instance_details.files.error_list', 'Could not list files')}: ${res?.error || 'Unknown error'}`, 'error');
                setFiles([]);
                return;
            }

            const sorted = [...(res.files || [])].sort((left, right) => {
                if (left.isDirectory && !right.isDirectory) return -1;
                if (!left.isDirectory && right.isDirectory) return 1;
                return String(left.name || '').localeCompare(String(right.name || ''));
            });

            setFiles(sorted);
        } catch (e: any) {
            console.error(e);
            addNotification(`${t('instance_details.files.error_list', 'Could not list files')}: ${e?.message || 'Unknown error'}`, 'error');
            setFiles([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFiles();
    }, [instanceName, currentPath]);

    const saveCurrentFile = async () => {
        if (!selectedFile) return true;
        if (!hasUnsavedChanges) return true;

        setIsSaving(true);
        const relativePath = normalizeJoin(currentPath, selectedFile.name);

        try {
            const res = await window.electronAPI.writeInstanceFile(instanceName, relativePath, editingContent);
            if (!res?.success) {
                addNotification(`${t('instance_details.files.error_save', 'Could not save file')}: ${res?.error || 'Unknown error'}`, 'error');
                return false;
            }

            addNotification(t('instance_details.files.save_success', 'File saved.'), 'success');
            setOriginalContent(editingContent);
            return true;
        } catch (e: any) {
            console.error(e);
            addNotification(`${t('instance_details.files.error_save', 'Could not save file')}: ${e?.message || 'Unknown error'}`, 'error');
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    useImperativeHandle(ref, () => ({
        saveCurrentFile,
        discardUnsavedChanges: () => {
            setEditingContent(originalContent);
        }
    }), [editingContent, originalContent, selectedFile, currentPath]);

    const handleBack = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        setCurrentPath(parts.join('/'));
    };

    const handleOpenFolder = (folderName: string) => {
        setCurrentPath((prev) => normalizeJoin(prev, folderName));
    };

    const handleOpenFile = async (file: any) => {
        const lower = String(file?.name || '').toLowerCase();
        const isText = TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));

        if (!isText) {
            addNotification(t('instance_details.files.not_editable', 'This file type cannot be edited in-app.'), 'info');
            return;
        }

        const relativePath = normalizeJoin(currentPath, file.name);
        try {
            const res = await window.electronAPI.readInstanceFile(instanceName, relativePath);
            if (!res?.success) {
                addNotification(`${t('instance_details.files.error_read', 'Could not open file')}: ${res?.error || 'Unknown error'}`, 'error');
                return;
            }

            setSelectedFile(file);
            setEditingContent(res.content || '');
            setOriginalContent(res.content || '');
            setSelectedFormat(inferFormatFromFilename(file.name));
        } catch (e: any) {
            console.error(e);
            addNotification(`${t('instance_details.files.error_read', 'Could not open file')}: ${e?.message || 'Unknown error'}`, 'error');
        }
    };

    const handleRequestCloseEditor = () => {
        if (!hasUnsavedChanges) {
            setSelectedFile(null);
            return;
        }
        setShowLeaveEditorModal(true);
    };

    const setEditorContentAndSelection = (nextValue: string, selectionStart: number, selectionEnd: number) => {
        setEditingContent(nextValue);
        requestAnimationFrame(() => {
            const textarea = getEditorTextarea();
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(selectionStart, selectionEnd);
        });
    };

    const applyIndentation = (shiftPressed: boolean) => {
        const textarea = getEditorTextarea();
        if (!textarea) return;

        const value = editingContent;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;

        if (!shiftPressed) {
            if (start === end) {
                const nextValue = `${value.slice(0, start)}  ${value.slice(end)}`;
                setEditorContentAndSelection(nextValue, start + 2, start + 2);
                return;
            }

            const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
            const lineEndIndex = value.indexOf('\n', end);
            const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
            const block = value.slice(lineStart, lineEnd);
            const lines = block.split('\n');
            const indented = lines.map((line) => `  ${line}`).join('\n');

            const nextValue = `${value.slice(0, lineStart)}${indented}${value.slice(lineEnd)}`;
            const nextStart = start + 2;
            const nextEnd = end + (2 * lines.length);
            setEditorContentAndSelection(nextValue, nextStart, nextEnd);
            return;
        }

        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const lineEndIndex = value.indexOf('\n', end);
        const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
        const block = value.slice(lineStart, lineEnd);
        const lines = block.split('\n');

        const removedByLine: number[] = [];
        const unindentedLines = lines.map((line) => {
            const match = line.match(/^(\t| {1,2})/);
            const removed = match ? match[0].length : 0;
            removedByLine.push(removed);
            return removed > 0 ? line.slice(removed) : line;
        });

        const nextBlock = unindentedLines.join('\n');
        const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;

        const removedOnFirstLine = removedByLine[0] || 0;
        const totalRemoved = removedByLine.reduce((sum, count) => sum + count, 0);

        const nextStart = Math.max(lineStart, start - removedOnFirstLine);
        const nextEnd = Math.max(nextStart, end - totalRemoved);
        setEditorContentAndSelection(nextValue, nextStart, nextEnd);
    };

    const jumpToSearchMatch = (matchIndex: number) => {
        if (searchMatches.length === 0) return;

        const normalizedIndex = ((matchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
        setActiveSearchMatch(normalizedIndex);

        const match = searchMatches[normalizedIndex];
        requestAnimationFrame(() => {
            const textarea = getEditorTextarea();
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(match.start, match.end);
        });
    };

    const closeSearchBar = () => {
        setShowSearchBar(false);
        requestAnimationFrame(() => {
            getEditorTextarea()?.focus();
        });
    };

    const handleEditorKeyDown = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            if (showSearchBar) {
                closeSearchBar();
            } else {
                setShowSearchBar(true);
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            void saveCurrentFile();
            return;
        }

        if (e.key === 'Tab') {
            e.preventDefault();
            applyIndentation(e.shiftKey);
            return;
        }

        if (e.key === 'F3' && searchMatches.length > 0) {
            e.preventDefault();
            jumpToSearchMatch(activeSearchMatch + (e.shiftKey ? -1 : 1));
        }
    };

    const discardAndCloseEditor = () => {
        setEditingContent(originalContent);
        setShowLeaveEditorModal(false);
        setSelectedFile(null);
    };

    const saveAndCloseEditor = async () => {
        setIsSavingAndClosing(true);
        try {
            const didSave = await saveCurrentFile();
            if (!didSave) return;
            setShowLeaveEditorModal(false);
            setSelectedFile(null);
        } finally {
            setIsSavingAndClosing(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!pendingDelete) return;
        const relativePath = normalizeJoin(currentPath, pendingDelete.name);

        try {
            const res = await window.electronAPI.deleteInstanceFile(instanceName, relativePath);
            if (!res?.success) {
                addNotification(`${t('instance_details.files.error_delete', 'Could not delete item')}: ${res?.error || 'Unknown error'}`, 'error');
                return;
            }

            addNotification(t('instance_details.files.delete_success', 'Deleted successfully.'), 'success');
            setPendingDelete(null);
            await loadFiles();
        } catch (e: any) {
            console.error(e);
            addNotification(`${t('instance_details.files.error_delete', 'Could not delete item')}: ${e?.message || 'Unknown error'}`, 'error');
        }
    };

    const handleCreateFolder = async () => {
        const folderName = newFolderName.trim();
        if (!folderName) return;

        const relativePath = normalizeJoin(currentPath, folderName);
        try {
            const res = await window.electronAPI.createInstanceDirectory(instanceName, relativePath);
            if (!res?.success) {
                addNotification(`${t('instance_details.files.error_create_folder', 'Could not create folder')}: ${res?.error || 'Unknown error'}`, 'error');
                return;
            }

            addNotification(t('instance_details.files.folder_created', 'Folder created.'), 'success');
            setNewFolderName('');
            setShowCreateFolder(false);
            await loadFiles();
        } catch (e: any) {
            console.error(e);
            addNotification(`${t('instance_details.files.error_create_folder', 'Could not create folder')}: ${e?.message || 'Unknown error'}`, 'error');
        }
    };

    const uploadFiles = async (selectedFiles: any[]) => {
        if (!selectedFiles?.length) return;
        setIsUploading(true);

        try {
            let successCount = 0;
            for (const file of selectedFiles) {
                const localPath = window.electronAPI.resolveDroppedFilePath(file);
                if (!localPath) continue;

                const targetPath = normalizeJoin(currentPath, file.name);
                const res = await window.electronAPI.uploadInstanceFile(instanceName, targetPath, localPath);
                if (res?.success) successCount++;
            }

            if (successCount > 0) {
                addNotification(t('instance_details.files.upload_success', '{{count}} file(s) uploaded.', { count: successCount }), 'success');
                await loadFiles();
            } else {
                addNotification(t('instance_details.files.upload_failed', 'Upload failed. Could not resolve local file paths.'), 'error');
            }
        } catch (e: any) {
            console.error(e);
            addNotification(`${t('instance_details.files.error_upload', 'Could not upload files')}: ${e?.message || 'Unknown error'}`, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);

        const droppedFiles = Array.from(e.dataTransfer.files || []);
        if (droppedFiles.length > 0) {
            await uploadFiles(droppedFiles as any[]);
        }
    };

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(e.target.files || []);
        if (selectedFiles.length > 0) {
            await uploadFiles(selectedFiles as any[]);
        }
        e.target.value = '';
    };

    if (selectedFile) {
        return (
            <div className="h-full rounded-xl border border-border bg-card overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-border bg-muted/70 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <button
                            onClick={handleRequestCloseEditor}
                            className="px-2 py-1 rounded-md bg-muted hover:bg-accent text-foreground text-xs border border-border"
                        >
                            {t('common.back', 'Back')}
                        </button>
                        <span className="text-sm font-semibold text-foreground truncate">{selectedFile.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-44">
                            <Dropdown
                                options={FORMAT_OPTIONS}
                                value={effectiveFormat}
                                onChange={setSelectedFormat}
                            />
                        </div>
                        <button
                            onClick={saveCurrentFile}
                            disabled={isSaving || !hasUnsavedChanges}
                            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover disabled:opacity-60 text-black text-xs font-bold"
                        >
                            {isSaving ? t('common.loading', 'Loading...') : t('common.save', 'Save')}
                        </button>
                    </div>
                </div>

                <div className="px-4 py-2 border-b border-border bg-background/70 flex items-center justify-between gap-3">
                    <span className={`text-xs font-semibold ${validationState.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {validationState.ok ? 'OK' : 'Error'}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{validationState.message}</span>
                </div>

                {showSearchBar && (
                    <div className="px-4 py-2 border-b border-border bg-background/70 flex items-center gap-2">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setActiveSearchMatch(0);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    jumpToSearchMatch(activeSearchMatch + (e.shiftKey ? -1 : 1));
                                }
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    closeSearchBar();
                                }
                            }}
                            onBlur={() => {
                                if (!searchQuery.trim()) {
                                    closeSearchBar();
                                }
                            }}
                            placeholder={t('instance_details.files.search_placeholder', 'Search in file...')}
                            className="flex-1 bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground outline-none"
                        />
                        <span className="text-xs text-muted-foreground min-w-[72px] text-right">
                            {searchMatches.length === 0
                                ? '0 / 0'
                                : `${activeSearchMatch + 1} / ${searchMatches.length}`}
                        </span>
                        <button
                            onClick={() => jumpToSearchMatch(activeSearchMatch - 1)}
                            disabled={searchMatches.length === 0}
                            className="px-2 py-1 rounded-md bg-muted hover:bg-accent disabled:opacity-50 text-xs text-foreground border border-border"
                        >
                            Prev
                        </button>
                        <button
                            onClick={() => jumpToSearchMatch(activeSearchMatch + 1)}
                            disabled={searchMatches.length === 0}
                            className="px-2 py-1 rounded-md bg-muted hover:bg-accent disabled:opacity-50 text-xs text-foreground border border-border"
                        >
                            Next
                        </button>
                        <button
                            onClick={closeSearchBar}
                            className="px-2 py-1 rounded-md bg-muted hover:bg-accent text-xs text-foreground border border-border"
                        >
                            Close
                        </button>
                    </div>
                )}

                <div ref={editorShellRef} className="relative flex-1 min-h-0 bg-background">
                    <div className="absolute inset-y-0 right-0 z-10 w-5 border-l border-border/60 bg-background/80 backdrop-blur-sm">
                        <div className="relative h-full w-full">
                            <div
                                className="absolute left-1/2 w-2 -translate-x-1/2 rounded-full border border-primary/25 bg-primary/10"
                                style={{
                                    top: `${Math.min(100 - viewportIndicator.heightPercent, viewportIndicator.topPercent)}%`,
                                    height: `${viewportIndicator.heightPercent}%`
                                }}
                            />
                            {searchMatchMarkers.map((marker) => (
                                <button
                                    key={`search-marker-${marker.index}`}
                                    type="button"
                                    onClick={() => jumpToSearchMatch(marker.index)}
                                    title={t('instance_details.files.search_jump_to_result', 'Jump to result')}
                                    className={`absolute left-1/2 w-3 -translate-x-1/2 rounded-full transition-colors ${marker.index === activeSearchMatch ? 'bg-primary shadow-[0_0_0_1px_rgba(255,255,255,0.25)]' : 'bg-yellow-400/80 hover:bg-yellow-300'}`}
                                    style={{
                                        top: `calc(${Math.min(99.4, marker.topPercent)}% - 1px)`,
                                        height: `${Math.min(10, Math.max(3, marker.heightPercent))}px`
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="h-full overflow-auto pr-5 custom-scrollbar">
                        <Editor
                            value={editingContent}
                            onValueChange={setEditingContent}
                            highlight={() => highlightedNodes}
                            textareaId="instance-file-editor"
                            textareaClassName="outline-none whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                            preClassName="!m-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                            padding={16}
                            style={{
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
                                fontSize: 12,
                                lineHeight: 1.25,
                                minHeight: '100%',
                                background: 'transparent',
                                color: 'var(--foreground)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                overflowWrap: 'anywhere'
                            }}
                            onKeyDown={handleEditorKeyDown}
                            spellCheck={false}
                        />
                    </div>
                </div>

                <div className="px-4 py-2 border-t border-border bg-background/70 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span>{t('instance_details.files.keybinds_label', 'Keybinds:')}</span>
                    <span>Ctrl+S Save</span>
                    <span>Ctrl+F Search</span>
                    <span>Tab Indent</span>
                    <span>Shift+Tab Unindent</span>
                    <span>Enter Next Match</span>
                    <span>Shift+Enter Previous Match</span>
                    <span>F3 Next/Previous</span>
                    <span>Esc Close Search</span>
                </div>

                {showLeaveEditorModal && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-10 flex items-center justify-center p-4">
                        <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg shadow-2xl">
                            <h3 className="text-xl font-bold text-foreground mb-2">
                                {t('instance_details.files.unsaved_title', 'Unsaved changes')}
                            </h3>
                            <p className="text-muted-foreground mb-6">
                                {t('instance_details.files.unsaved_desc', 'You have unsaved changes in the current file. What do you want to do?')}
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowLeaveEditorModal(false)}
                                    className="flex-1 px-4 py-2 rounded-xl bg-muted hover:bg-accent text-foreground font-bold transition-all"
                                >
                                    {t('instance_details.files.back_to_file', 'Back to file')}
                                </button>
                                <button
                                    onClick={discardAndCloseEditor}
                                    className="flex-1 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 font-bold border border-red-500/30 transition-all"
                                >
                                    {t('instance_details.files.discard_changes', 'Do not save')}
                                </button>
                                <button
                                    onClick={saveAndCloseEditor}
                                    disabled={isSavingAndClosing}
                                    className="flex-1 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-black font-bold transition-all"
                                >
                                    {isSavingAndClosing ? t('common.loading', 'Loading...') : t('common.save', 'Save')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="h-full rounded-xl border border-border bg-card overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/70 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={handleBack}
                        disabled={!currentPath}
                        className="px-2 py-1 rounded-md bg-muted hover:bg-accent disabled:opacity-40 text-foreground text-xs border border-border"
                    >
                        {t('common.back', 'Back')}
                    </button>
                    <div className="text-xs text-muted-foreground truncate">
                        {currentPath ? `/${currentPath}` : '/'}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowCreateFolder((prev) => !prev)}
                        className="px-2 py-1 rounded-md bg-muted hover:bg-accent text-foreground text-xs border border-border"
                    >
                        {t('instance_details.files.new_folder', 'New Folder')}
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="px-2 py-1 rounded-md bg-muted hover:bg-accent disabled:opacity-50 text-foreground text-xs border border-border"
                    >
                        {isUploading ? t('common.loading', 'Loading...') : t('instance_details.files.upload', 'Upload')}
                    </button>
                </div>
            </div>

            {showCreateFolder && (
                <div className="px-4 py-2 border-b border-border bg-background/60 flex items-center gap-2">
                    <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder={t('instance_details.files.folder_name_placeholder', 'Folder name')}
                        className="flex-1 bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground outline-none"
                    />
                    <button
                        onClick={handleCreateFolder}
                        className="px-2 py-1 rounded-md bg-primary text-black text-xs font-bold"
                    >
                        {t('common.create', 'Create')}
                    </button>
                </div>
            )}

            <div
                className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 ${isDraggingOver ? 'bg-primary/5 ring-2 ring-primary ring-inset' : ''}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(true);
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingOver(false);
                }}
                onDrop={handleDrop}
            >
                {loading ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        {t('instance_details.files.loading', 'Loading files...')}
                    </div>
                ) : files.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        {t('instance_details.files.empty', 'This folder is empty.')}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {files.map((file) => (
                            <div
                                key={file.name}
                                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-transparent hover:border-border hover:bg-accent/60"
                            >
                                <button
                                    onClick={() => (file.isDirectory ? handleOpenFolder(file.name) : handleOpenFile(file))}
                                    className="min-w-0 flex-1 text-left"
                                >
                                    <div className="text-sm text-foreground truncate">{file.isDirectory ? `📁 ${file.name}` : `📄 ${file.name}`}</div>
                                    <div className="text-[11px] text-muted-foreground">{file.isDirectory ? t('instance_details.files.folder', 'Folder') : `${Math.round((Number(file.size) || 0) / 1024)} KB`}</div>
                                </button>
                                <button
                                    onClick={() => setPendingDelete(file)}
                                    className="px-2 py-1 rounded-md bg-muted hover:bg-red-500/20 text-xs text-muted-foreground hover:text-red-400 border border-border"
                                >
                                    {t('common.delete', 'Delete')}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {pendingDelete && (
                <div className="p-3 border-t border-border bg-background/80 flex items-center justify-between gap-3">
                    <div className="text-xs text-foreground truncate">
                        {t('instance_details.files.delete_confirm', 'Delete {{name}}?', { name: pendingDelete.name })}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPendingDelete(null)}
                            className="px-2 py-1 rounded-md bg-muted hover:bg-accent text-xs text-foreground border border-border"
                        >
                            {t('common.cancel', 'Cancel')}
                        </button>
                        <button
                            onClick={handleConfirmDelete}
                            className="px-2 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-xs text-red-300 border border-red-500/30"
                        >
                            {t('common.delete', 'Delete')}
                        </button>
                    </div>
                </div>
            )}

            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
            />
        </div>
    );
});

export default InstanceFileBrowser;
