import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../context/NotificationContext';
import ConfirmationModal from './ConfirmationModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Upload, FolderUp, Loader2, X, FileIcon, Folder } from 'lucide-react';

const FileBrowser = ({ serverName }) => {
    const { t } = useTranslation();
    const { addNotification } = useNotification();
    const [files, setFiles] = useState([]);
    const [currentPath, setCurrentPath] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedFile, setSelectedFile] = useState(null);
    const [editingContent, setEditingContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadedFiles, setUploadedFiles] = useState([]);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const fileInputRef = useRef(null);
    const dropZoneRef = useRef(null);

    useEffect(() => {
        loadFiles();
    }, [currentPath, serverName]);

    const loadFiles = async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.listServerFiles(serverName, currentPath);
            if (res.success) {
                setFiles(res.files.sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                }));
            } else {
                addNotification(t('server_details.files.error_list') + ': ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(t('server_details.files.error_list'), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleFolderClick = (name) => {
        setCurrentPath(currentPath ? `${currentPath}/${name}` : name);
    };

    const handleBackClick = () => {
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
    };

    const handleFileClick = async (file) => {
        const textExtensions = ['.txt', '.log', '.properties', '.yml', '.yaml', '.json', '.conf', '.sh', '.bat', '.py', '.js', '.secret', '.toml'];
        const isText = textExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

        if (!isText) {
            addNotification(t('server_details.files.not_editable'), 'info');
            return;
        }

        try {
            const res = await window.electronAPI.readServerFile(serverName, `${currentPath}/${file.name}`);
            if (res.success) {
                setSelectedFile(file);
                setEditingContent(res.content);
            } else {
                addNotification(t('server_details.files.error_read') + ': ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(t('server_details.files.error_read'), 'error');
        }
    };

    const handleSave = async () => {
        if (!selectedFile) return;
        setIsSaving(true);
        try {
            const res = await window.electronAPI.writeServerFile(serverName, `${currentPath}/${selectedFile.name}`, editingContent);
            if (res.success) {
                addNotification(t('server_details.files.save_success'), 'success');
                setSelectedFile(null);
                loadFiles();
            } else {
                addNotification(t('server_details.files.error_save') + ': ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(t('server_details.files.error_save'), 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!showDeleteConfirm) return;
        try {
            const res = await window.electronAPI.deleteServerFile(serverName, `${currentPath}/${showDeleteConfirm.name}`);
            if (res.success) {
                addNotification(t('server_details.files.delete_success'), 'success');
                loadFiles();
            } else {
                addNotification(t('server_details.files.error_delete') + ': ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(t('server_details.files.error_delete'), 'error');
        } finally {
            setShowDeleteConfirm(null);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        try {
            const res = await window.electronAPI.createServerDirectory(serverName, `${currentPath}/${newFolderName}`);
            if (res.success) {
                addNotification(t('server_details.files.folder_created'), 'success');
                setNewFolderName('');
                setIsCreatingFolder(false);
                loadFiles();
            } else {
                addNotification(t('server_details.files.error_create_folder') + ': ' + res.error, 'error');
            }
        } catch (e) {
            console.error(e);
            addNotification(t('server_details.files.error_create_folder'), 'error');
        }
    };

        const handleOpenUploadModal = () => {
        setUploadedFiles([]);
        setUploadProgress(0);
        setShowUploadModal(true);
    };

    const handleFilesSelected = async (selectedFiles) => {
        if (!selectedFiles || selectedFiles.length === 0) return;
        
        setIsUploading(true);
        setUploadProgress(0);
        const uploaded = [];
        
        try {
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
                const relativePath = file.webkitRelativePath || file.name;
                const targetPath = currentPath ? `${currentPath}/${relativePath}` : relativePath;
                
                try {
                    const res = await window.electronAPI.uploadServerFile(serverName, targetPath, file.path || file);
                    if (res.success) {
                        uploaded.push({ name: file.name, path: relativePath, status: 'success' });
                    } else {
                        uploaded.push({ name: file.name, path: relativePath, status: 'error', error: res.error });
                    }
                } catch (e) {
                    uploaded.push({ name: file.name, path: relativePath, status: 'error', error: e.message });
                }
                
                setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
            }
            
            setUploadedFiles(uploaded);
            
            if (uploaded.length === 1 && uploaded[0].status === 'success') {
                addNotification(t('server_details.files.upload_success'), 'success');
            } else if (uploaded.filter(f => f.status === 'success').length > 0) {
                addNotification(`${uploaded.filter(f => f.status === 'success').length} ${t('server_details.files.files_uploaded')}`, 'success');
            }
            
            loadFiles();
        } catch (e) {
            console.error(e);
            addNotification(t('server_details.files.error_upload') + ': ' + e.message, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setIsDraggingOver(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
            handleFilesSelected(droppedFiles);
        }
    };

    const handleBrowseClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileInputChange = (e) => {
        const selectedFiles = Array.from(e.target.files);
        if (selectedFiles.length > 0) {
            handleFilesSelected(selectedFiles);
        }
        e.target.value = '';
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (selectedFile) {
        const isReadOnly = selectedFile.name.toLowerCase().endsWith('.secret');

        return (
            <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden glass-panel">
                <div className="p-4 border-b border-border flex items-center justify-between bg-muted">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <button onClick={() => setSelectedFile(null)} className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                            </svg>
                        </button>
                        <span className="font-medium text-foreground truncate">{selectedFile.name}</span>
                        {isReadOnly && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground border border-border uppercase tracking-wider backdrop-blur-sm">
                                {t('common.readonly')}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {isReadOnly && (
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(editingContent).then(() => {
                                        addNotification('Copied to clipboard', 'success');
                                    });
                                }}
                                className="px-3 py-2 text-sm font-medium bg-muted hover:bg-accent text-foreground rounded-lg transition-all flex items-center gap-2"
                                title="Copy to clipboard"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                Copy
                            </button>
                        )}
                        <button
                            onClick={() => setSelectedFile(null)}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-accent-foreground transition-colors"
                        >
                            {t('common.cancel')}
                        </button>
                        {!isReadOnly && (
                            <button
                                onClick={handleSave}
                                disabled={isSaving}
                                className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-black rounded-lg transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSaving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                                {t('common.save')}
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex-1 p-4 overflow-hidden">
                    <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        readOnly={isReadOnly}
                        className={`w-full h-full bg-black/40 text-foreground font-mono text-sm p-4 rounded-xl border border-border focus:border-primary/50 focus:ring-1 focus:ring-primary/50 outline-none resize-none custom-scrollbar ${isReadOnly ? 'opacity-80 cursor-default' : ''}`}
                        spellCheck="false"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden glass-panel">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted">
                <div className="flex items-center gap-2 overflow-hidden">
                    <button
                        onClick={handleBackClick}
                        disabled={!currentPath}
                        className={`p-2 rounded-lg transition-colors ${!currentPath ? 'text-muted-foreground cursor-not-allowed' : 'text-muted-foreground hover:text-accent-foreground hover:bg-accent'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                    <div className="flex items-center gap-1 text-sm overflow-hidden whitespace-nowrap">
                        <span className="text-muted-foreground">/</span >
                        {currentPath.split('/').filter(Boolean).map((part, i, arr) => (
                            <React.Fragment key={i}>
                                <button
                                    onClick={() => setCurrentPath(arr.slice(0, i + 1).join('/'))}
                                    className="text-muted-foreground hover:text-accent-foreground transition-colors"
                                >
                                    {part}
                                </button>
                                {i < arr.length - 1 && <span className="text-muted-foreground">/</span>}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {isCreatingFolder ? (
                        <div className="flex items-center gap-2 bg-black/40 p-1 pl-3 rounded-lg border border-border">
                            <input
                                autoFocus
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateFolder();
                                    if (e.key === 'Escape') setIsCreatingFolder(false);
                                }}
                                className="bg-transparent border-none outline-none text-sm text-foreground w-32"
                                placeholder={t('server_details.files.folder_name')}
                            />
                            <button onClick={handleCreateFolder} className="p-1 text-primary transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                            </button>
                            <button onClick={() => setIsCreatingFolder(false)} className="p-1 text-red-400 transition-transform">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            </button>
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={() => setIsCreatingFolder(true)}
                                className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                                title={t('server_details.files.new_folder')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z" clipRule="evenodd" />
                                </svg>
                            </button>
                            <button
                                onClick={handleOpenUploadModal}
                                className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                                title={t('server_details.files.upload')}
                            >
                                <Upload className="h-5 w-5" />
                            </button>
                        </>
                    )}
                    <button
                        onClick={loadFiles}
                        className="p-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground hover:text-accent-foreground"
                        title={t('common.refresh')}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading && files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
                        <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        <span>{t('common.loading')}...</span>
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="text-sm opacity-50">{t('server_details.files.empty')}</span>
                    </div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="sticky top-0 bg-card border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-3 font-medium">{t('common.name')}</th>
                                <th className="px-6 py-3 font-medium text-right">{t('common.size')}</th>
                                <th className="px-6 py-3 font-medium text-right">{t('common.modified')}</th>
                                <th className="px-6 py-3 font-medium w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {files.map((file) => (
                                <tr
                                    key={file.name}
                                    className="group hover:bg-accent transition-colors cursor-pointer"
                                    onClick={() => file.isDirectory ? handleFolderClick(file.name) : handleFileClick(file)}
                                >
                                    <td className="px-6 py-3">
                                        <div className="flex items-center gap-3">
                                            {file.isDirectory ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500/80" viewBox="0 0 20 20" fill="currentColor">
                                                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                                </svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-400/80" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                            <span className="text-sm text-foreground group-hover:text-accent-foreground transition-colors">{file.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-3 text-right font-mono text-xs text-muted-foreground">
                                        {file.isDirectory ? '--' : formatSize(file.size)}
                                    </td>
                                    <td className="px-6 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                                        {new Date(file.mtime).toLocaleDateString()} {new Date(file.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="px-6 py-3">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowDeleteConfirm(file);
                                            }}
                                            className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-lg transition-all"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {showDeleteConfirm && (
                <ConfirmationModal
                    title={t('server_details.files.delete_title')}
                    message={t('server_details.files.delete_confirm', { name: showDeleteConfirm.name })}
                    onConfirm={handleDelete}
                    onCancel={() => setShowDeleteConfirm(null)}
                    type="danger"
                />
            )}
            
            <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('server_details.files.upload_title')}</DialogTitle>
                    </DialogHeader>
                    
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFileInputChange}
                    />
                    
                    <div
                        ref={dropZoneRef}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={handleBrowseClick}
                        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                            isDraggingOver 
                                ? 'border-primary bg-primary/10' 
                                : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        }`}
                    >
                        <div className="flex flex-col items-center gap-4">
                            <div className={`p-4 rounded-full ${isDraggingOver ? 'bg-primary/20' : 'bg-muted'}`}>
                                <FolderUp className={`h-8 w-8 ${isDraggingOver ? 'text-primary' : 'text-muted-foreground'}`} />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-foreground">
                                    {isDraggingOver 
                                        ? t('server_details.files.drop_here') 
                                        : t('server_details.files.drag_or_click')
                                    }
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t('server_details.files.upload_hint')}
                                </p>
                            </div>
                        </div>
                    </div>

                    {isUploading && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{t('server_details.files.uploading')}</span>
                                <span className="font-mono text-foreground">{uploadProgress}%</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-primary transition-all duration-300 rounded-full"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {uploadedFiles.length > 0 && !isUploading && (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                {t('server_details.files.upload_results')}
                            </p>
                            {uploadedFiles.map((file, index) => (
                                <div 
                                    key={index}
                                    className={`flex items-center gap-2 p-2 rounded-lg ${
                                        file.status === 'success' ? 'bg-green-500/10' : 'bg-red-500/10'
                                    }`}
                                >
                                    {file.status === 'success' ? (
                                        <FileIcon className="h-4 w-4 text-green-500 shrink-0" />
                                    ) : (
                                        <X className="h-4 w-4 text-red-500 shrink-0" />
                                    )}
                                    <span className="text-sm text-foreground truncate flex-1">{file.name}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-4 border-t border-border">
                        <Button variant="outline" onClick={() => setShowUploadModal(false)}>
                            {uploadedFiles.length > 0 && !isUploading ? t('common.done') : t('common.cancel')}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default FileBrowser;
