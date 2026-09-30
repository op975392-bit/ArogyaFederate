import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowDownRight, ArrowUpRight, BedDouble, Bell, Check, ChevronRight, CircleHelp, Clock3, Cross, Download, Globe2, HeartPulse, MapPin, Menu, PackageCheck, Radio, RefreshCw, ShieldCheck, Signal, Stethoscope, Truck, Users, Wifi, WifiOff, X } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';
const ITEMS = ['Paracetamol', 'Insulin', 'Oxygen Cylinders', 'Vaccines'];
const palette = { Red: '#fb7185', Yellow: '#f5c86b', Green: '#64dba5' };

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.detail || `Request failed (${response.status})`); }
  return response.json();
}
function MapResize({ selected }) { const map = useMap(); useEffect(() => { setTimeout(() => map.invalidateSize(), 150); }, [map, selected]); return null; }
function StatCard({ icon: Icon, label, value, detail, tone, trend }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={17}/></div><div className="stat-copy"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-detail">{trend && <span className="trend"><ArrowDownRight size={12}/>{trend}</span>}{detail}</div></div></div>;
}
function RiskTag({ risk }) { return <span className={`risk-tag ${risk?.toLowerCase()}`}><i/> {risk || 'Unknown'}</span>; }

export default function App() {
  const [phcs, setPhcs] = useState(() => { try { return JSON.parse(localStorage.getItem('arogya-phcs') || '[]'); } catch { return []; } });
  const [stats, setStats] = useState({});
  const [selected, setSelected] = useState(null);
  const [item, setItem] = useState('Paracetamol');
  const [forecast, setForecast] = useState(null);
  const [plan, setPlan] = useState([]);
  const [federation, setFederation] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(() => { try { return JSON.parse(localStorage.getItem('arogya-pending') || '[]').length; } catch { return 0; } });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [showUpdate, setShowUpdate] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [data, recommendations, federationData] = await Promise.all([
        request('/api/phcs'), request('/api/redistribute', { method: 'POST', body: JSON.stringify({}) }), request('/api/federation/status')
      ]);
      setPhcs(data.phcs); setStats(data.stats); setPlan(recommendations.plan || []); setFederation(federationData);
      localStorage.setItem('arogya-phcs', JSON.stringify(data.phcs)); setOnline(true);
    } catch { setOnline(false); }
  }, []);
  useEffect(() => { refresh(); const id = setInterval(refresh, 60000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => {
    const goOnline = async () => {
      setOnline(true);
      let queue = []; try { queue = JSON.parse(localStorage.getItem('arogya-pending') || '[]'); } catch {}
      if (queue.length) {
        for (const entry of queue) { try { await request('/api/phc/update', { method: 'POST', body: JSON.stringify(entry) }); } catch { return; } }
        localStorage.removeItem('arogya-pending'); setPending(0); setToast('Offline updates synced'); refresh();
      }
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline); window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [refresh]);
  useEffect(() => {
    if (selected) {
      const latest = phcs.find(p => p.id === selected.id);
      if (latest && latest !== selected) setSelected(latest);
    }
  }, [phcs]);
  useEffect(() => {
    if (!selected) { setForecast(null); return; }
    let active = true; setLoading(true); setForecast(null);
    request(`/api/forecast/${selected.id}/${encodeURIComponent(item)}`).then(v => { if (active) setForecast(v); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected, item]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); } }, [toast]);

  const districts = useMemo(() => [...new Set(phcs.map(p => p.district))], [phcs]);
  const chartData = useMemo(() => {
    if (!forecast) return [];
    return [...forecast.history.map(d => ({ date: d.date.slice(5), actual: d.actual, predicted: null })),
      ...forecast.forecast.map(d => ({ date: d.date.slice(5), actual: null, predicted: d.predicted }))];
  }, [forecast]);

  const approve = async (route) => {
    try {
      await request('/api/redistribute/approve', { method: 'POST', body: JSON.stringify({ from_phc: route.from_phc, to_phc: route.to_phc, item: route.item, quantity: route.quantity }) });
      setToast(`Transfer of ${route.quantity} ${route.item} approved`); await refresh();
      if (selected) setSelected(phcs.find(p => p.id === selected.id) || selected);
    } catch (e) { setToast(e.message); }
  };
  const saveUpdate = async (payload) => {
    setSaving(true);
    const queueLocally = () => {
      const queue = JSON.parse(localStorage.getItem('arogya-pending') || '[]'); queue.push(payload); localStorage.setItem('arogya-pending', JSON.stringify(queue)); setPending(queue.length);
      setShowUpdate(false); setToast('Saved on this device — will sync when online');
      // Apply queued edit optimistically so the offline map reflects the local submission.
      setPhcs(old => { const next = old.map(p => p.id === payload.phc_id ? { ...p, occupied_beds: payload.occupied_beds ?? p.occupied_beds, staff_present: payload.staff_present ?? p.staff_present, stocks: payload.stock != null ? { ...p.stocks, [payload.item]: { ...p.stocks[payload.item], stock: payload.stock } } : p.stocks } : p); localStorage.setItem('arogya-phcs', JSON.stringify(next)); return next; });
    };
    try {
      if (!navigator.onLine) { queueLocally(); return; }
      await request('/api/phc/update', { method: 'POST', body: JSON.stringify(payload) });
      setToast('PHC record updated'); setShowUpdate(false); await refresh();
    } catch (e) {
      if (!navigator.onLine || e instanceof TypeError) queueLocally();
      else setToast(e.message || 'Could not save this PHC update');
    } finally { setSaving(false); }
  };
  const exportCsv = () => {
    const rows = [['PHC', 'District', 'Risk', ...ITEMS.map(i => `${i} stock`), 'Beds free', 'Staff present'], ...phcs.map(p => [p.name, p.district, p.risk, ...ITEMS.map(i => p.stocks?.[i]?.stock ?? 0), p.bed_capacity - p.occupied_beds, p.staff_present])];
    const blob = new Blob([rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'arogya-phc-snapshot.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Cross size={20} strokeWidth={3}/></div><div><div className="brand-name">Arogya<span>Federate</span></div><div className="brand-sub">BRICS HEALTH RESILIENCE NETWORK</div></div></div>
      <div className="top-center"><div className="live-pill"><span className="pulse-dot"/>LIVE OPERATIONS</div><span className="top-divider"/><span className="system-label">National Health Command Center</span></div>
      <div className="top-actions"><div className={`connect-status ${online ? 'connected' : 'disconnected'}`}>{online ? <Wifi size={14}/> : <WifiOff size={14}/>}<span>{online ? 'Connected' : 'Offline mode'}</span></div>{pending > 0 && <span className="queue-pill">{pending} queued</span>}<button className="icon-button" title="Notifications"><Bell size={17}/><i className="notification-dot"/></button><div className="avatar">AF</div></div>
    </header>
    <main className="dashboard">
      <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/> NATIONAL RESOURCE OVERVIEW <span className="date-label">{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</span></div><h1>Health systems, <em>in sync.</em></h1><p className="welcome-copy">A live view of frontline capacity, medical inventory and coordinated response.</p></div><div className="welcome-actions"><span className="updated"><Clock3 size={13}/> Auto-refresh · 60 sec</span><button className="button secondary" onClick={refresh}><RefreshCw size={14}/> Refresh data</button><button className="button export" onClick={exportCsv}><Download size={14}/> Export snapshot</button></div></section>
      <section className="stats-grid">
        <StatCard icon={MapPin} label="PHC NETWORK" value={stats.total_phcs ?? '—'} detail="across 3 districts" tone="teal" />
        <StatCard icon={Activity} label="CRITICAL ALERTS" value={stats.critical ?? '—'} detail="immediate attention" tone="red" trend={stats.critical ? 'Action' : null} />
        <StatCard icon={BedDouble} label="BEDS AVAILABLE" value={stats.beds_available ?? '—'} detail="across network" tone="blue" />
        <StatCard icon={Users} label="STAFF ON DUTY" value={stats.staff_present ?? '—'} detail="health personnel" tone="violet" />
      </section>
      <div className="main-grid">
        <section className="panel map-panel">
          <div className="panel-heading"><div><div className="section-kicker">GEOSPATIAL SITUATIONAL AWARENESS</div><h2>PHC network map <span className="sub-count">{phcs.length || 30} facilities</span></h2></div><button className="district-filter" onClick={() => { if (phcs.length) setSelected(phcs[Math.floor(Math.random() * phcs.length)]); }}><Menu size={14}/> Explore facilities</button></div>
          <div className="map-wrap">
            {phcs.length ? <MapContainer center={[22.94, 75.90]} zoom={9} scrollWheelZoom className="leaflet-map">
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {phcs.map(p => <CircleMarker key={p.id} center={[p.latitude, p.longitude]} radius={selected?.id === p.id ? 10 : 7} pathOptions={{ color: '#0c1821', weight: 2, fillColor: palette[p.risk] || palette.Green, fillOpacity: 0.95 }} eventHandlers={{ click: () => setSelected(p) }}><Popup><strong>{p.name}</strong><br/>{p.district}<br/>Status: {p.risk}</Popup></CircleMarker>)}<MapResize selected={selected}/>
            </MapContainer> : <div className="map-loading"><div className="map-grid"/><div className="loading-center"><div className="spinner"/><span>{online ? 'Connecting to PHC network…' : 'No cached network data available'}</span></div></div>}
            <div className="map-legend"><span className="legend-title">SUPPLY STATUS</span><span><i className="legend-dot green"/>Stable</span><span><i className="legend-dot yellow"/>At risk</span><span><i className="legend-dot red"/>Critical</span></div>
            <div className="map-overlay-label"><Globe2 size={13}/> MALWA REGION · INDIA</div>
          </div>
          <div className="map-footer"><span><span className="sync-mini"/> Locations update as facilities report</span><button onClick={() => setShowUpdate(true)}><Activity size={14}/> Update PHC data <ChevronRight size={14}/></button></div>
        </section>
        <section className="panel transfer-panel">
          <div className="panel-heading"><div><div className="section-kicker">AI-ASSISTED RESPONSE</div><h2>Redistribution plan <span className="recommend-tag">{plan.length} routes</span></h2></div><div className="optim-icon"><Truck size={17}/></div></div>
          <div className="transfer-caption"><span>Optimized for urgency & distance</span><span className="solver-label">LP OPTIMIZED</span></div>
          <div className="routes-list">
            {plan.length ? plan.slice(0, 6).map((route, idx) => <article className="route-card" key={`${route.from_phc}-${route.to_phc}-${route.item}-${idx}`}>
              <div className="route-priority"><span className={`priority-dot ${route.priority.toLowerCase()}`}/><span>{route.priority} priority</span><span className="route-distance">{route.distance_km} km</span></div>
              <div className="route-line"><div className="route-point"><span className="point-source"/><div><small>FROM</small><b>{route.from_name}</b></div></div><div className="route-track"><span/><Truck size={13}/><span/></div><div className="route-point"><span className="point-target"/><div><small>TO</small><b>{route.to_name}</b></div></div></div>
              <div className="route-bottom"><span><PackageCheck size={14}/><b>{route.quantity.toLocaleString()}</b> {route.item}</span><button className="approve-button" onClick={() => approve(route)}><Check size={13}/> Approve</button></div>
            </article>) : <div className="empty-state"><PackageCheck size={25}/><b>Network in balance</b><span>No surplus-to-deficit transfer routes found.</span></div>}
          </div>
          <button className="view-routes" onClick={async () => { const d = await request('/api/redistribute', { method: 'POST', body: JSON.stringify({}) }).catch(() => ({ plan: [] })); setPlan(d.plan || []); setToast('Recommendations recalculated'); }}>Recalculate recommendations <ArrowUpRight size={14}/></button>
        </section>
      </div>
      <section className="bottom-grid">
        <div className="panel district-panel"><div className="panel-heading compact"><div><div className="section-kicker">FIELD OPERATIONS</div><h2>District readiness</h2></div><button className="text-action" onClick={() => setShowUpdate(true)}>Update data <ChevronRight size={14}/></button></div>
          <div className="district-list">{districts.map(name => { const subset = phcs.filter(p => p.district === name); const critical = subset.filter(p => p.risk === 'Red').length; const risk = subset.filter(p => p.risk === 'Yellow').length; const ready = subset.length - critical - risk; const percent = subset.length ? Math.round(ready / subset.length * 100) : 0; return <div className="district-row" key={name}><div className="district-emblem"><MapPin size={15}/></div><div className="district-info"><b>{name}</b><span>{subset.length} PHCs · {critical} critical</span></div><div className="readiness-track"><i style={{ width: `${percent}%` }}/></div><b className="readiness-value">{percent}%</b><RiskTag risk={critical ? 'Red' : risk ? 'Yellow' : 'Green'}/></div>; })}{!districts.length && <div className="skeleton-line"/>}</div>
        </div>
        <div className="panel federation-panel"><div className="panel-heading compact"><div><div className="section-kicker">PRIVACY-PRESERVING AI</div><h2>Federated learning <span className="fed-badge"><i/> ACTIVE</span></h2></div><div className="shield-icon"><ShieldCheck size={19}/></div></div>
          <div className="fed-summary"><div><span>GLOBAL MODEL MAE</span><b>{federation?.global_mae ?? '—'}<small> units / day</small></b></div><div><span>AGGREGATION ROUND</span><b>#{federation?.round ?? '—'}</b></div><div className="privacy-note"><ShieldCheck size={15}/><span>Raw health records stay on local nodes.<br/>Only model weights are shared.</span></div></div>
          <div className="node-row">{(federation?.nodes || [{ country: 'India', status: 'Connecting' }, { country: 'Brazil', status: 'Connecting' }, { country: 'South Africa', status: 'Connecting' }]).map(node => <div className="node-chip" key={node.country}><span className={`node-indicator ${node.status === 'Connected' ? 'on' : ''}`}/><span>{node.country}</span><small>{node.status === 'Connected' ? 'ONLINE' : node.status.toUpperCase()}</small></div>)}</div>
        </div>
      </section>
      <footer className="footer"><span><HeartPulse size={14}/> Built for resilient primary care</span><span>ArogyaFederate <b>·</b> Prototype mode <b>·</b> Data is synthetic</span><button onClick={() => setToast('Prototype only — not for clinical decision-making.')}><CircleHelp size={14}/> About this view</button></footer>
    </main>

    {selected && <div className="drawer-backdrop" onClick={() => setSelected(null)}><aside className="drawer" onClick={e => e.stopPropagation()}>
      <div className="drawer-top"><div><div className="section-kicker">FACILITY PROFILE · #{String(selected.id).padStart(3, '0')}</div><h2>{selected.name}</h2><span className="drawer-district"><MapPin size={13}/>{selected.district}</span></div><button className="icon-button" onClick={() => setSelected(null)}><X size={18}/></button></div>
      <div className="drawer-status"><RiskTag risk={selected.risk}/><span>Last report · {online ? 'just now' : 'cached locally'}</span><button onClick={() => setShowUpdate(true)}>Edit <ChevronRight size={13}/></button></div>
      <div className="drawer-metrics"><div><BedDouble size={16}/><span>BEDS FREE</span><b>{selected.bed_capacity - selected.occupied_beds}<small> / {selected.bed_capacity}</small></b></div><div><Users size={16}/><span>STAFF PRESENT</span><b>{selected.staff_present}<small> / {selected.staff_count}</small></b></div></div>
      <div className="drawer-section-title"><h3>Medicine inventory</h3><span>Stock · days of cover</span></div>
      <div className="inventory-list">{ITEMS.map(name => { const d = selected.stocks?.[name] || {}; const days = d.avg_daily_use ? Math.floor(d.stock / d.avg_daily_use) : 0; return <div className="inventory-item" key={name}><div className="med-icon"><Cross size={14}/></div><div className="med-copy"><b>{name}</b><span>Expires {d.expiry_date || '—'}</span></div><div className="med-stock"><b>{(d.stock || 0).toLocaleString()}</b><span>units</span></div><div className="cover"><RiskTag risk={d.risk}/><span>{days}d cover</span></div></div>; })}</div>
      <div className="drawer-section-title forecast-title"><div><h3>Demand forecast</h3><span>30-day local model projection</span></div><select value={item} onChange={e => setItem(e.target.value)}>{ITEMS.map(x => <option key={x}>{x}</option>)}</select></div>
      <div className="chart-shell">{loading ? <div className="chart-loading"><div className="spinner"/>Training local model…</div> : forecast ? <><div className="chart-legend"><span><i className="actual-key"/>Actual use</span><span><i className="forecast-key"/>Forecast</span><b>{forecast.predicted_30d_total.toLocaleString()}<small> projected units</small></b></div><ResponsiveContainer width="100%" height={182}><AreaChart data={chartData} margin={{ top: 8, right: 7, left: -24, bottom: 0 }}><defs><linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#51d7ab" stopOpacity={0.19}/><stop offset="90%" stopColor="#51d7ab" stopOpacity={0}/></linearGradient><linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8c9eff" stopOpacity={0.17}/><stop offset="90%" stopColor="#8c9eff" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#233640" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tick={{ fill: '#718590', fontSize: 9 }} axisLine={false} tickLine={false} interval={9}/><YAxis tick={{ fill: '#718590', fontSize: 9 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: '#12222d', border: '1px solid #31434e', borderRadius: 8, color: '#edf4f4', fontSize: 11 }} /><Area type="monotone" dataKey="actual" stroke="#51d7ab" strokeWidth={2} fill="url(#actualFill)" connectNulls={false} dot={false}/><Area type="monotone" dataKey="predicted" stroke="#9aa7ff" strokeWidth={2} strokeDasharray="5 4" fill="url(#forecastFill)" connectNulls={false} dot={false}/></AreaChart></ResponsiveContainer><div className="model-caption"><Activity size={12}/>{forecast.model} · trained on 90 days of local usage</div></> : <div className="chart-loading">Forecast unavailable while offline</div>}</div>
      <div className="drawer-actions"><button className="button secondary" onClick={() => setShowUpdate(true)}><Stethoscope size={14}/> Update facility</button><button className="button export" onClick={() => { setSelected(null); }}><Check size={14}/> Done</button></div>
    </aside></div>}
    {showUpdate && <UpdateModal phcs={phcs} initial={selected} onClose={() => setShowUpdate(false)} onSave={saveUpdate} saving={saving}/>}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </div>;
}

function UpdateModal({ phcs, initial, onClose, onSave, saving }) {
  const [phcId, setPhcId] = useState(String(initial?.id || phcs[0]?.id || ''));
  const phc = phcs.find(p => p.id === Number(phcId));
  const [item, setItem] = useState('Paracetamol');
  const [stock, setStock] = useState(phc?.stocks?.Paracetamol?.stock ?? 0);
  const [beds, setBeds] = useState(phc?.occupied_beds ?? 0);
  const [staff, setStaff] = useState(phc?.staff_present ?? 0);
  useEffect(() => { setStock(phc?.stocks?.[item]?.stock ?? 0); setBeds(phc?.occupied_beds ?? 0); setStaff(phc?.staff_present ?? 0); }, [phcId, item]);
  const submit = e => { e.preventDefault(); onSave({ phc_id: Number(phcId), item, stock: Number(stock), occupied_beds: Number(beds), staff_present: Number(staff) }); };
  return <div className="modal-backdrop" onClick={onClose}><form className="update-modal" onSubmit={submit} onClick={e => e.stopPropagation()}><div className="modal-head"><div><div className="section-kicker">FIELD REPORTING</div><h2>Update PHC status</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18}/></button></div><p className="modal-hint">Updates are stored locally if connectivity drops, then synced automatically.</p><label>Primary health centre<select value={phcId} onChange={e => setPhcId(e.target.value)}>{phcs.map(p => <option key={p.id} value={p.id}>{p.name} · {p.district}</option>)}</select></label><div className="form-two"><label>Medicine item<select value={item} onChange={e => setItem(e.target.value)}>{ITEMS.map(x => <option key={x}>{x}</option>)}</select></label><label>Stock on hand<input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} required/></label></div><div className="form-two"><label>Occupied beds<input type="number" min="0" max={phc?.bed_capacity || 100} value={beds} onChange={e => setBeds(e.target.value)} required/></label><label>Staff present<input type="number" min="0" max={phc?.staff_count || 100} value={staff} onChange={e => setStaff(e.target.value)} required/></label></div><div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button export" type="submit" disabled={saving}>{saving ? 'Saving…' : <><Check size={14}/> Save PHC report</>}</button></div></form></div>;
}
