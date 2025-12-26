import React, { useState, useEffect } from 'react';
import { getFiles, createFile, deleteFile } from '../services/api';
import {
    FolderOpen, Folder, File, FileCode, FileJson, FileText,
    Image, Settings, Coffee, Database, Package, Plus, Trash2,
    FolderPlus, RefreshCw, ChevronRight, ChevronDown
} from 'lucide-react';

// File icon mapping
const getFileIcon = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const iconMap = {
        js: { icon: FileCode, color: 'text-yellow-400' },
        jsx: { icon: FileCode, color: 'text-cyan-400' },
        ts: { icon: FileCode, color: 'text-blue-400' },
        tsx: { icon: FileCode, color: 'text-blue-400' },
        css: { icon: FileCode, color: 'text-blue-500' },
        scss: { icon: FileCode, color: 'text-pink-400' },
        html: { icon: FileCode, color: 'text-orange-500' },
        json: { icon: FileJson, color: 'text-yellow-500' },
        md: { icon: FileText, color: 'text-white' },
        txt: { icon: FileText, color: 'text-gray-400' },
        py: { icon: FileCode, color: 'text-green-400' },
        java: { icon: Coffee, color: 'text-orange-400' },
        sql: { icon: Database, color: 'text-blue-300' },
        png: { icon: Image, color: 'text-purple-400' },
        jpg: { icon: Image, color: 'text-purple-400' },
        jpeg: { icon: Image, color: 'text-purple-400' },
        svg: { icon: Image, color: 'text-orange-400' },
        ico: { icon: Image, color: 'text-purple-300' },
        env: { icon: Settings, color: 'text-yellow-300' },
        gitignore: { icon: Settings, color: 'text-gray-500' },
    };

    // Special filenames
    if (filename === 'package.json') return { icon: Package, color: 'text-green-400' };
    if (filename === 'package-lock.json') return { icon: Package, color: 'text-green-300' };
    if (filename.startsWith('.env')) return { icon: Settings, color: 'text-yellow-300' };

    return iconMap[ext] || { icon: File, color: 'text-gray-400' };
};

const FileTreeNode = ({ node, onSelect, onContextMenu, level = 0 }) => {
    const [isOpen, setIsOpen] = useState(level < 1);
    const isFolder = node.type === 'folder';
    const { icon: FileIcon, color } = isFolder
        ? { icon: isOpen ? FolderOpen : Folder, color: 'text-amber-400' }
        : getFileIcon(node.name);

    const handleClick = (e) => {
        e.stopPropagation();
        if (isFolder) {
            setIsOpen(!isOpen);
        } else {
            onSelect(node);
        }
    };

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, node);
    };

    return (
        <div style={{ marginLeft: level > 0 ? '12px' : '0' }}>
            <div
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                className={`
                    flex items-center gap-2 py-1 px-2 rounded-md cursor-pointer
                    text-[13px] text-[#ccc] transition-all duration-150
                    hover:bg-white/5 hover:text-white
                    ${isFolder ? '' : 'hover:bg-amber-500/10'}
                `}
            >
                {isFolder && (
                    <span className="text-[#555] w-3">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                )}
                {!isFolder && <span className="w-3" />}
                <FileIcon size={14} className={color} />
                <span className="truncate flex-1">{node.name}</span>
            </div>

            {isOpen && node.children && (
                <div className={level > 0 ? 'border-l border-[#222] ml-[7px]' : ''}>
                    {node.children
                        .sort((a, b) => {
                            if (a.type === b.type) return a.name.localeCompare(b.name);
                            return a.type === 'folder' ? -1 : 1;
                        })
                        .map((child) => (
                            <FileTreeNode
                                key={child.path}
                                node={child}
                                onSelect={onSelect}
                                onContextMenu={onContextMenu}
                                level={level + 1}
                            />
                        ))}
                </div>
            )}
        </div>
    );
};

const FileExplorer = ({ onFileSelect }) => {
    const [fileTree, setFileTree] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadFiles();
        const interval = setInterval(loadFiles, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const loadFiles = async () => {
        try {
            const tree = await getFiles();
            setFileTree(tree);
        } catch (err) {
            console.error('Failed to load files', err);
        } finally {
            setLoading(false);
        }
    };

    const handleContextMenu = (e, node) => {
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            node: node
        });
    };

    const handleCreate = async (type) => {
        if (!contextMenu) return;
        const parentPath = contextMenu.node.type === 'folder'
            ? contextMenu.node.path
            : contextMenu.node.path.split(/[/\\]/).slice(0, -1).join('/');

        const name = prompt(`Enter ${type === 'folder' ? 'folder' : 'file'} name:`);
        if (name) {
            const sep = parentPath.includes('\\') ? '\\' : '/';
            const fullPath = parentPath + sep + name;
            await createFile(fullPath, type);
            loadFiles();
        }
    };

    const handleDelete = async () => {
        if (!contextMenu) return;
        if (confirm(`Delete "${contextMenu.node.name}"? This cannot be undone.`)) {
            await deleteFile(contextMenu.node.path);
            loadFiles();
        }
    };

    return (
        <div className="flex flex-col h-full text-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
                <span className="text-[10px] font-semibold text-[#666] uppercase tracking-wider">
                    Explorer
                </span>
                <div className="flex gap-1">
                    <button
                        onClick={() => handleCreate('file')}
                        className="p-1 hover:bg-[#222] rounded text-[#666] hover:text-white transition-colors"
                        title="New File"
                    >
                        <Plus size={14} />
                    </button>
                    <button
                        onClick={() => handleCreate('folder')}
                        className="p-1 hover:bg-[#222] rounded text-[#666] hover:text-white transition-colors"
                        title="New Folder"
                    >
                        <FolderPlus size={14} />
                    </button>
                    <button
                        onClick={loadFiles}
                        className="p-1 hover:bg-[#222] rounded text-[#666] hover:text-white transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {/* File Tree */}
            <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-32 text-[#444]">
                        <RefreshCw size={20} className="animate-spin mb-2" />
                        <span className="text-xs">Loading...</span>
                    </div>
                ) : fileTree ? (
                    <FileTreeNode
                        node={fileTree}
                        onSelect={onFileSelect}
                        onContextMenu={handleContextMenu}
                    />
                ) : (
                    <div className="text-center text-[#444] py-8 text-xs">
                        No folder open
                    </div>
                )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <div className="context-menu-item" onClick={() => handleCreate('file')}>
                        <Plus size={14} /> New File
                    </div>
                    <div className="context-menu-item" onClick={() => handleCreate('folder')}>
                        <FolderPlus size={14} /> New Folder
                    </div>
                    <div className="h-px bg-[#2a2a2a] my-1" />
                    <div className="context-menu-item text-red-400 hover:text-red-300" onClick={handleDelete}>
                        <Trash2 size={14} /> Delete
                    </div>
                </div>
            )}
        </div>
    );
};

export default FileExplorer;
