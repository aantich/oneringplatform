import { memo, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Bot,
  Box,
  Braces,
  CheckCircle2,
  LayoutDashboard,
  PlugZap,
  Route,
  ScrollText,
  X,
} from 'lucide-react';
import type { ArtifactType, SpecArtifact } from '../types';
import { StatusPill } from './StatusPill';

const meta: Record<ArtifactType, { label: string; icon: typeof Bot; color: string }> = {
  story: { label: 'Story', icon: ScrollText, color: '#b794ff' },
  entity: { label: 'Domain', icon: Box, color: '#3fd3b5' },
  screen: { label: 'Screen', icon: LayoutDashboard, color: '#55a6ff' },
  workflow: { label: 'Workflow', icon: Route, color: '#ffb454' },
  agent: { label: 'Agent', icon: Bot, color: '#ff6f91' },
  integration: { label: 'Integration', icon: PlugZap, color: '#8d95ac' },
  test: { label: 'Evidence', icon: CheckCircle2, color: '#7ade83' },
};

type ArtifactNode = Node<{ artifact: SpecArtifact }, 'artifact'>;

const ArtifactCard = memo(({ data, selected }: NodeProps<ArtifactNode>) => {
  const artifact = data.artifact;
  const item = meta[artifact.type];
  const Icon = item.icon;
  return (
    <div className={`artifact-node ${selected ? 'artifact-node--selected' : ''}`} style={{ '--node-color': item.color } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="artifact-handle" />
      <div className="artifact-node__header">
        <span className="artifact-node__icon"><Icon size={14} /></span>
        <span>{item.label}</span>
        <span className={`artifact-dot artifact-dot--${artifact.status}`} />
      </div>
      <strong>{artifact.name}</strong>
      <p>{artifact.description}</p>
      {artifact.links.length > 0 && <small>{artifact.links.length} connection{artifact.links.length > 1 ? 's' : ''}</small>}
      <Handle type="source" position={Position.Right} className="artifact-handle" />
    </div>
  );
});
ArtifactCard.displayName = 'ArtifactCard';

const nodeTypes = { artifact: ArtifactCard };

export function VisualCanvas({
  artifacts,
  onMove,
  onUpdate,
}: {
  artifacts: SpecArtifact[];
  onMove: (id: string, position: { x: number; y: number }) => void;
  onUpdate: (id: string, patch: Partial<SpecArtifact>) => void;
}) {
  const [selectedType, setSelectedType] = useState<ArtifactType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string>();

  const visible = useMemo(() => {
    if (selectedType === 'all') return artifacts;
    const direct = new Set(artifacts.filter((item) => item.type === selectedType).map((item) => item.id));
    artifacts.forEach((item) => item.links.forEach((link) => {
      if (direct.has(item.id)) direct.add(link.targetId);
    }));
    return artifacts.filter((item) => direct.has(item.id));
  }, [artifacts, selectedType]);

  const nodes: ArtifactNode[] = visible.map((item) => ({
    id: item.id,
    type: 'artifact',
    position: item.position,
    data: { artifact: item },
  }));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges: Edge[] = visible.flatMap((item) =>
    item.links
      .filter((link) => visibleIds.has(link.targetId))
      .map((link) => ({
        id: `${item.id}-${link.targetId}-${link.relation}`,
        source: item.id,
        target: link.targetId,
        label: link.relation,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#536079' },
        style: { stroke: '#536079', strokeWidth: 1.4 },
        labelStyle: { fill: '#8791a8', fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#121827', fillOpacity: 0.92 },
      })),
  );
  const selected = artifacts.find((item) => item.id === selectedId);

  return (
    <section className="canvas-card">
      <div className="canvas-toolbar">
        <div>
          <div className="eyebrow">Living application blueprint</div>
          <h2>Everything stays connected</h2>
        </div>
        <div className="canvas-filters" role="group" aria-label="Blueprint view">
          <button className={selectedType === 'all' ? 'active' : ''} onClick={() => setSelectedType('all')}>All</button>
          {(Object.keys(meta) as ArtifactType[]).map((type) => {
            const Icon = meta[type].icon;
            return <button key={type} className={selectedType === type ? 'active' : ''} onClick={() => setSelectedType(type)}><Icon size={13} />{meta[type].label}</button>;
          })}
        </div>
      </div>
      <div className="canvas-stage">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.12}
          maxZoom={1.6}
          onInit={(instance) => window.setTimeout(() => instance.fitView({ padding: 0.15 }), 60)}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(undefined)}
          onNodeDragStop={(_, node) => onMove(node.id, node.position)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#252d41" gap={28} size={1} />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => meta[(node.data?.artifact as SpecArtifact).type].color}
            maskColor="rgba(7, 10, 18, 0.78)"
          />
        </ReactFlow>
        {selected && (
          <aside className="artifact-inspector">
            <button className="icon-button artifact-inspector__close" aria-label="Close details" onClick={() => setSelectedId(undefined)}><X size={16} /></button>
            <div className="artifact-inspector__type" style={{ color: meta[selected.type].color }}>
              {meta[selected.type].label}
            </div>
            <h3>{selected.name}</h3>
            <p>{selected.description}</p>
            <div className="inspector-row"><span>Status</span><StatusPill status={selected.status} /></div>
            {Object.entries(selected.details).slice(0, 4).map(([key, value]) => (
              <div className="inspector-detail" key={key}>
                <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                <strong>{Array.isArray(value) ? value.join(' · ') : String(value)}</strong>
              </div>
            ))}
            <label className="inspector-label" htmlFor="artifact-description">Plain-language description</label>
            <textarea
              id="artifact-description"
              defaultValue={selected.description}
              onBlur={(event) => {
                if (event.target.value !== selected.description) onUpdate(selected.id, { description: event.target.value });
              }}
            />
            <div className="inspector-links">
              <Braces size={14} /> Stable id <code>{selected.id}</code>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
