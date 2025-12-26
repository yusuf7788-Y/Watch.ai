import React, { useState, useEffect } from 'react';
import FileExplorer from './components/FileExplorer';
import CodeEditor from './components/CodeEditor';
import Terminal from './components/Terminal';
import ChatInterface from './components/ChatInterface';
import TitleBar from './components/TitleBar';
import { getFileContent, saveFile } from './services/api';
import { Files, Search, GitBranch, Play, Settings, Bot, Terminal as TerminalIcon, X, Maximize2, Minimize2 } from 'lucide-react';
import './App.css';

function App() {
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [activeSidebar, setActiveSidebar] = useState('explorer');
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [isChatExpanded, setIsChatExpanded] = useState(false);

  const handleFileSelect = async (node) => {
    if (openFiles.find(f => f.path === node.path)) {
      setActiveFilePath(node.path);
      return;
    }

    try {
      const content = await getFileContent(node.path);
      const newFile = {
        path: node.path,
        name: node.name,
        content: content,
      };
      setOpenFiles([...openFiles, newFile]);
      setActiveFilePath(node.path);
    } catch (err) {
      console.error('Error loading file:', err);
    }
  };

  const closeFile = (e, path) => {
    e.stopPropagation();
    const newFiles = openFiles.filter(f => f.path !== path);
    setOpenFiles(newFiles);
    if (activeFilePath === path) {
      setActiveFilePath(newFiles.length > 0 ? newFiles[newFiles.length - 1].path : null);
    }
  };

  const updateFileContent = (value) => {
    setOpenFiles(prev => prev.map(f => {
      if (f.path === activeFilePath) return { ...f, content: value };
      return f;
    }));
  };

  const activeFileObj = openFiles.find(f => f.path === activeFilePath);

  // Get file extension for language detection
  const getLanguage = (filePath) => {
    if (!filePath) return 'plaintext';
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', css: 'css', scss: 'scss', html: 'html',
      json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml'
    };
    return langMap[ext] || 'plaintext';
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0a0a] overflow-hidden select-none">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        <div className="w-12 bg-[#0d0d0d] flex flex-col items-center py-4 gap-4 border-r border-[#1a1a1a]">
          {/* Logo */}
          <div className="mb-4 p-1">
            <img
              src="/logo.png"
              alt="Watch.ai"
              className="w-7 h-7 opacity-80 hover:opacity-100 transition-opacity"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>

          <ActivityIcon
            icon={<Files size={22} />}
            active={activeSidebar === 'explorer'}
            onClick={() => setActiveSidebar('explorer')}
            title="Explorer"
          />
          <ActivityIcon
            icon={<Search size={22} />}
            active={activeSidebar === 'search'}
            onClick={() => setActiveSidebar('search')}
            title="Search"
          />
          <ActivityIcon
            icon={<GitBranch size={22} />}
            active={activeSidebar === 'git'}
            onClick={() => setActiveSidebar('git')}
            title="Source Control"
          />

          <div className="flex-1" />

          <ActivityIcon
            icon={<Settings size={20} />}
            onClick={() => { }}
            title="Settings"
          />
        </div>

        {/* Sidebar */}
        <div className="w-60 bg-[#0d0d0d] border-r border-[#1a1a1a] flex flex-col overflow-hidden">
          {activeSidebar === 'explorer' && <FileExplorer onFileSelect={handleFileSelect} />}
          {activeSidebar === 'search' && <PlaceholderSidebar title="Search" icon={<Search />} />}
          {activeSidebar === 'git' && <PlaceholderSidebar title="Source Control" icon={<GitBranch />} />}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col bg-[#0d0d0d] min-w-0">
          {/* Tabs */}
          <div className="flex bg-[#0a0a0a] h-9 overflow-x-auto border-b border-[#1a1a1a] scrollbar-hide">
            {openFiles.map(file => (
              <div
                key={file.path}
                className={`group flex items-center gap-2 px-4 min-w-[140px] cursor-pointer text-xs border-r border-[#1a1a1a] transition-all ${file.path === activeFilePath
                    ? 'bg-[#141414] text-white'
                    : 'text-[#666] hover:bg-[#111] hover:text-[#999]'
                  }`}
                onClick={() => setActiveFilePath(file.path)}
              >
                <FileIcon filename={file.name} />
                <div className="truncate flex-1">{file.name}</div>
                <div
                  className="p-1 hover:bg-[#333] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => closeFile(e, file.path)}
                >
                  <X size={12} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex-1 relative flex overflow-hidden">
            {/* Editor Area */}
            <div className={`flex flex-col min-w-0 transition-all duration-300 ${isChatExpanded ? 'flex-[0.4]' : 'flex-1'}`}>
              <main className="flex-1 relative bg-[#0d0d0d]">
                {activeFilePath ? (
                  <CodeEditor
                    code={activeFileObj?.content || ''}
                    language={getLanguage(activeFilePath)}
                    path={activeFilePath}
                    onChange={updateFileContent}
                  />
                ) : (
                  <WelcomeScreen />
                )}
              </main>

              {/* Terminal Panel */}
              {isTerminalOpen && (
                <div className="h-[28vh] border-t border-[#1a1a1a] bg-[#0a0a0a] flex flex-col">
                  <div className="flex items-center justify-between px-4 py-1.5 border-b border-[#1a1a1a]">
                    <div className="flex gap-6 text-[10px] font-semibold text-[#666] uppercase tracking-wider">
                      <span className="text-[#e0e0e0] border-b border-amber-500 pb-1 cursor-pointer">Terminal</span>
                      <span className="hover:text-[#999] cursor-pointer pb-1">Output</span>
                      <span className="hover:text-[#999] cursor-pointer pb-1">Problems</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsTerminalOpen(false)}
                        className="p-1 hover:bg-[#222] rounded text-[#666] hover:text-white transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Terminal />
                  </div>
                </div>
              )}
            </div>

            {/* AI Chat Panel */}
            <div className={`border-l border-[#1a1a1a] flex flex-col bg-[#0a0a0a] transition-all duration-300 ${isChatExpanded ? 'flex-[0.6]' : 'w-80'
              }`}>
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a1a]">
                <div className="flex items-center gap-2">
                  <Bot size={14} className="text-amber-500" />
                  <span className="text-[10px] font-semibold text-[#666] uppercase tracking-wider">AI Agent</span>
                </div>
                <button
                  onClick={() => setIsChatExpanded(!isChatExpanded)}
                  className="p-1 hover:bg-[#222] rounded text-[#666] hover:text-white transition-colors"
                >
                  {isChatExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatInterface activeFile={activeFilePath} fileContent={activeFileObj?.content} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-6 bg-[#0a0a0a] border-t border-[#1a1a1a] flex items-center px-3 text-[10px] text-[#555]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            Ready
          </span>
          {activeFilePath && (
            <span>{getLanguage(activeFilePath).toUpperCase()}</span>
          )}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <span>Watch.ai v1.0</span>
          <button
            onClick={() => setIsTerminalOpen(!isTerminalOpen)}
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <TerminalIcon size={12} />
            Terminal
          </button>
        </div>
      </div>
    </div>
  );
}

// Activity Bar Icon
const ActivityIcon = ({ icon, active, onClick, title }) => (
  <button
    className={`p-2 rounded-lg transition-all duration-200 ${active
        ? 'text-white bg-[#1a1a1a]'
        : 'text-[#555] hover:text-[#999] hover:bg-[#141414]'
      }`}
    onClick={onClick}
    title={title}
  >
    {icon}
  </button>
);

// File Icon based on extension
const FileIcon = ({ filename }) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const colors = {
    js: 'text-yellow-400', jsx: 'text-cyan-400', ts: 'text-blue-400', tsx: 'text-blue-400',
    css: 'text-blue-500', scss: 'text-pink-400', html: 'text-orange-500',
    json: 'text-yellow-500', md: 'text-white', py: 'text-green-400'
  };

  return (
    <div className={`w-4 h-4 flex items-center justify-center text-[10px] font-bold ${colors[ext] || 'text-[#666]'}`}>
      {ext?.substring(0, 2).toUpperCase() || 'F'}
    </div>
  );
};

// Welcome Screen
const WelcomeScreen = () => (
  <div className="h-full flex flex-col items-center justify-center text-[#444]">
    <img
      src="/logo.png"
      alt="Watch.ai"
      className="w-20 h-20 opacity-20 mb-6"
      onError={(e) => {
        e.target.style.display = 'none';
      }}
    />
    <div className="text-2xl font-bold opacity-30 tracking-widest uppercase mb-2">Watch.ai</div>
    <div className="text-sm opacity-20">Select a file or ask the AI Agent</div>
    <div className="mt-8 text-xs opacity-15 text-center max-w-md">
      <p>Tip: Use the AI Agent panel on the right to generate code,</p>
      <p>edit files, and run commands automatically.</p>
    </div>
  </div>
);

// Placeholder Sidebar
const PlaceholderSidebar = ({ title, icon }) => (
  <div className="p-4 flex flex-col h-full">
    <div className="text-xs font-semibold text-[#666] uppercase tracking-wider mb-4 flex items-center gap-2">
      {icon} {title}
    </div>
    <div className="flex-1 flex flex-col items-center justify-center text-[#444] text-center text-xs">
      <Settings size={24} className="mb-2 opacity-20" />
      <p className="opacity-50">Coming soon</p>
    </div>
  </div>
);

export default App;
