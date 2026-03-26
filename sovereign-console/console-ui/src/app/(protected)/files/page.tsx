'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type FileEntry, type FileContent, type Project } from '@/lib/api';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import DiffViewer from '@/components/files/DiffViewer';
import ApprovalModal from '@/components/approval/ApprovalModal';
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  Lock,
  Eye,
} from 'lucide-react';

function TreeNode({
  entry,
  depth,
  onSelect,
  selectedPath,
}: {
  entry: FileEntry;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDir = entry.type === 'directory';
  const isSelected = selectedPath === entry.path;

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors hover:bg-surface-overlay ${
          isSelected ? 'bg-surface-overlay text-accent-blue' : 'text-text-secondary'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) {
            setExpanded(!expanded);
          } else {
            onSelect(entry.path);
          }
        }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
          )
        ) : (
          <span className="w-3" />
        )}
        {isDir ? (
          <Folder className="h-4 w-4 flex-shrink-0 text-accent-blue/60" />
        ) : (
          <File className="h-4 w-4 flex-shrink-0 text-text-muted" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilesPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'content' | 'diff'>('content');

  useEffect(() => {
    api.system.projects().then(({ data }) => {
      if (data && data.length > 0) {
        setProjects(data);
        setSelectedProject(data[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    api.files.tree(selectedProject).then(({ data }) => {
      if (data) setTree(data);
    });
  }, [selectedProject]);

  const handleSelectFile = useCallback(
    async (path: string) => {
      setSelectedFile(path);
      setLoadingContent(true);
      setViewMode('content');

      const { data } = await api.files.content(selectedProject, path);
      if (data) setFileContent(data);
      setLoadingContent(false);
    },
    [selectedProject]
  );

  const handleViewDiff = useCallback(async () => {
    if (!selectedFile) return;
    setViewMode('diff');
    const { data } = await api.files.diff(selectedProject, selectedFile);
    if (data) setFileDiff(data.diff);
  }, [selectedProject, selectedFile]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Files
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Browse project files. View only — no raw downloads.
          </p>
        </div>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm text-text-primary focus:border-accent-blue focus:outline-none"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        {/* Tree sidebar */}
        <Card padding="sm">
          <div className="max-h-[calc(100vh-220px)] overflow-auto scrollbar-thin">
            {tree.length === 0 ? (
              <p className="p-2 text-sm text-text-muted">No files found.</p>
            ) : (
              tree.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  onSelect={handleSelectFile}
                  selectedPath={selectedFile}
                />
              ))
            )}
          </div>
        </Card>

        {/* Content viewer */}
        <Card>
          {!selectedFile ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Eye className="mb-3 h-8 w-8 text-text-muted" />
              <p className="text-sm text-text-secondary">
                Select a file to view its contents.
              </p>
            </div>
          ) : loadingContent ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <File className="h-4 w-4 text-text-muted" />
                  <span className="font-mono text-sm text-text-primary">
                    {selectedFile}
                  </span>
                  {fileContent?.redacted && (
                    <Badge variant="warning">
                      <Lock className="mr-1 h-3 w-3" />
                      Redacted
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={viewMode === 'content' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('content')}
                  >
                    Content
                  </Button>
                  <Button
                    variant={viewMode === 'diff' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={handleViewDiff}
                  >
                    Diff
                  </Button>
                </div>
              </div>

              {viewMode === 'content' && fileContent && (
                <div className="max-h-[calc(100vh-320px)] overflow-auto rounded-lg border border-border bg-surface p-4 scrollbar-thin">
                  <pre className="font-mono text-sm leading-relaxed text-text-secondary">
                    {fileContent.content.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="mr-4 inline-block w-8 select-none text-right text-text-muted">
                          {i + 1}
                        </span>
                        <span>{line || ' '}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}

              {viewMode === 'diff' && fileDiff && (
                <DiffViewer diff={fileDiff} />
              )}

              {viewMode === 'diff' && !fileDiff && (
                <p className="py-8 text-center text-sm text-text-muted">
                  No pending changes for this file.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {approvalId && (
        <ApprovalModal
          approvalId={approvalId}
          onClose={() => setApprovalId(null)}
        />
      )}
    </div>
  );
}
