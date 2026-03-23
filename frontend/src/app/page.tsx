"use client";

import { useState, useEffect } from "react";

const GCP_REGIONS = [
  "asia-east1", "asia-east2", "asia-northeast1", "asia-northeast2", "asia-northeast3",
  "asia-south1", "asia-south2", "asia-southeast1", "asia-southeast2",
  "australia-southeast1", "australia-southeast2",
  "europe-central2", "europe-north1", "europe-southwest1",
  "europe-west1", "europe-west2", "europe-west3", "europe-west4", "europe-west6", "europe-west8", "europe-west9", "europe-west12",
  "me-central1", "me-central2", "me-west1",
  "northamerica-northeast1", "northamerica-northeast2",
  "southamerica-east1", "southamerica-west1",
  "us-central1", "us-east1", "us-east4", "us-east5",
  "us-south1", "us-west1", "us-west2", "us-west3", "us-west4"
];

export default function Home() {
  const [projectID, setProjectID] = useState("");
  const [impersonateEmail, setImpersonateEmail] = useState("");
  const [status, setStatus] = useState("");
  const [planOutput, setPlanOutput] = useState("");
  const [resources, setResources] = useState<Record<string, string[][]>>({});
  const [activeResources, setActiveResources] = useState<Record<string, string[][]>>({});
  const [viewMode, setViewMode] = useState<"none" | "auth" | "discovered" | "active" | "plan">("none");
  const [loading, setLoading] = useState(false);
  const [isAuthPolling, setIsAuthPolling] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const [bulkRegion, setBulkRegion] = useState("");
  const [bulkSubnet, setBulkSubnet] = useState("");

  const toggleSection = (sectionKey: string) => {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const applyBulkUpdate = () => {
    setActiveResources(prev => {
      const updated = { ...prev };
      for (const serviceKey in updated) {
        const rows = [...updated[serviceKey]];
        if (rows.length > 0) {
          const header = rows[0];
          const regionIdx = header.indexOf("NewRegion");
          const subnetIdx = header.indexOf("NewSubnet");
          
          for (let i = 1; i < rows.length; i++) {
            rows[i] = [...rows[i]];
            if (regionIdx !== -1 && bulkRegion) {
              rows[i][regionIdx] = bulkRegion;
            }
            if (subnetIdx !== -1 && bulkSubnet) {
              rows[i][subnetIdx] = bulkSubnet;
            }
          }
        }
        updated[serviceKey] = rows;
      }
      return updated;
    });
    setStatus("Bulk update applied to active resources.");
  };

  const fetchResources = async () => {
    try {
      const res = await fetch(`http://localhost:8080/api/gcp/resources`);
      const data = await res.json();
      setResources(data);
    } catch (e) {
      console.error("Failed to fetch resources", e);
    }
  };

  const fetchActiveResources = async () => {
    try {
      const res = await fetch(`http://localhost:8080/api/gcp/resources/active`);
      const data = await res.json();
      if (data && !data.error) {
        for (const key in data) {
          const rows = data[key];
          if (rows.length > 0) {
            const header = rows[0];
            let regionIdx = header.indexOf("NewRegion");
            let subnetIdx = header.indexOf("NewSubnet");
            
            if (regionIdx === -1) {
              header.push("NewRegion");
              for (let i = 1; i < rows.length; i++) rows[i].push("");
            }
            if (subnetIdx === -1) {
              header.push("NewSubnet");
              for (let i = 1; i < rows.length; i++) rows[i].push("");
            }
          }
        }
        setActiveResources(data);
      } else {
        setActiveResources({});
      }
    } catch (e) {
      console.error("Failed to fetch active resources", e);
      setActiveResources({});
    }
  };

  const updateActiveResource = (serviceKey: string, rowIndex: number, colIndex: number, value: string) => {
    setActiveResources(prev => {
      const updated = { ...prev };
      const rows = [...(updated[serviceKey] || [])];
      rows[rowIndex] = [...rows[rowIndex]];
      rows[rowIndex][colIndex] = value;
      updated[serviceKey] = rows;
      return updated;
    });
  };

  const removeActiveResource = (serviceKey: string, rowIndex: number) => {
    setActiveResources(prev => {
      const updated = { ...prev };
      const rows = [...(updated[serviceKey] || [])];
      rows.splice(rowIndex, 1);
      if (rows.length <= 1) {
        delete updated[serviceKey];
      } else {
        updated[serviceKey] = rows;
      }
      return updated;
    });
  };

  const removeActiveService = (serviceKey: string) => {
    setActiveResources(prev => {
      const updated = { ...prev };
      delete updated[serviceKey];
      return updated;
    });
  };

  const addActiveResource = (serviceKey: string, resourceRow: string[]) => {
    setActiveResources(prev => {
      const updated = { ...prev };
      let header = [];
      if (!updated[serviceKey]) {
        header = [...(resources[serviceKey]?.[0] || [])];
        if (!header.includes("NewRegion")) header.push("NewRegion");
        if (!header.includes("NewSubnet")) header.push("NewSubnet");
        updated[serviceKey] = [header];
      } else {
        header = updated[serviceKey][0];
      }
      
      const newRow = [...resourceRow];
      for (let i = newRow.length; i < header.length; i++) {
        const colName = header[i];
        if (colName === "NewRegion" || colName === "NewSubnet") {
          newRow.push("");
        } else {
          newRow.push("Manual");
        }
      }
      
      const exists = updated[serviceKey].some((r, i) => i > 0 && r[0] === newRow[0]);
      if (!exists) {
        updated[serviceKey] = [...updated[serviceKey], newRow];
      }
      return updated;
    });
  };

  const handleAction = async (endpoint: string, method = "POST") => {
    // Session / Cache mechanism to avoid hitting API unnecessarily
    if (endpoint === "discover" && Object.keys(resources).length > 0) {
      setViewMode("discovered");
      return;
    }
    if (endpoint === "filter" && Object.keys(activeResources).length > 0) {
      setViewMode("active");
      return;
    }
    if (endpoint === "auth" && status.includes("successful")) {
      setViewMode("auth");
      return;
    }

    if (endpoint === "plan") {
      await apiCall(endpoint, "POST", activeResources);
    } else {
      await apiCall(endpoint, method);
    }
  };

  const apiCall = async (endpoint: string, method = "POST", bodyData?: any) => {
    setLoading(true);
    setStatus(`Executing ${endpoint}...`);
    try {
      const options: RequestInit = { method };
      if (bodyData) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(bodyData);
      }
      const res = await fetch(`http://localhost:8080/api/gcp/${endpoint}?project=${projectID}`, options);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (endpoint === "plan") {
        setPlanOutput(data.plan_output);
        setStatus("Infrastructure plan generated successfully.");
        setViewMode("plan");
      } else if (endpoint === "auth") {
        setStatus(data.status);
        setIsAuthPolling(true);
        setViewMode("auth");
      } else if (endpoint === "discover") {
        setStatus("Resource discovery completed.");
        await fetchResources();
        setViewMode("discovered");
      } else if (endpoint === "filter") {
        setStatus("Active resources filtered and categorized.");
        await fetchActiveResources();
        setViewMode("active");
      } else {
        setStatus(data.status);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAuthPolling) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`http://localhost:8080/api/gcp/auth/status`);
          const data = await res.json();
          if (data.status === "Completed") {
            setStatus("Authentication successful! You can now proceed to discovery.");
            setIsAuthPolling(false);
          } else if (data.status.startsWith("Failed")) {
            setStatus(`Authentication ${data.status}`);
            setIsAuthPolling(false);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [isAuthPolling]);

  // Clear session cache when project changes
  useEffect(() => {
    setPlanOutput("");
    setResources({});
    setActiveResources({});
    setStatus("");
    setViewMode("none");
    setExpandedSections({});
  }, [projectID]);

  const steps = [
    { id: "auth", label: "Authenticate", color: "bg-orange-500" },
    { id: "discovered", label: "Discover", color: "bg-blue-500" },
    { id: "active", label: "Filter", color: "bg-emerald-500" },
    { id: "plan", label: "Plan", color: "bg-purple-500" }
  ];

  return (
    <main className="min-h-screen bg-blue-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">GeoShield <span className="text-blue-600">Control Plane</span></h1>
              <p className="text-sm text-slate-500 font-medium">Cloud Landing Zone Automation</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-full border border-blue-100">
            <div className={`w-2 h-2 rounded-full ${loading ? "bg-blue-500 animate-ping" : "bg-green-500"}`} />
            <span className="text-xs font-bold text-blue-700 uppercase tracking-widest">{loading ? "Processing" : "Ready"}</span>
          </div>
        </header>

        {/* Project & Workflow Control */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end gap-6">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">GCP Project Configuration</label>
              <div className="relative">
                <input
                  type="text"
                  value={projectID}
                  onChange={(e) => setProjectID(e.target.value)}
                  placeholder="Enter Project ID..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-mono text-blue-700"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
              {steps.map((step, idx) => (
                <div key={step.id} className="flex items-center cursor-pointer" onClick={() => {
                   if (step.id === "plan" && planOutput) setViewMode("plan");
                   else if (step.id === "discovered" && Object.keys(resources).length > 0) setViewMode("discovered");
                   else if (step.id === "active" && Object.keys(activeResources).length > 0) setViewMode("active");
                   else if (step.id === "auth" && status.includes("successful")) setViewMode("auth");
                }}>
                  <div className={`flex flex-col items-center px-3 py-1 rounded-lg transition-all ${viewMode === step.id ? "bg-blue-50 border border-blue-200" : "opacity-40 hover:opacity-80"}`}>
                    <span className={`text-[10px] font-black uppercase ${viewMode === step.id ? "text-blue-600" : "text-slate-400"}`}>Step {idx + 1}</span>
                    <span className="text-xs font-bold whitespace-nowrap">{step.label}</span>
                  </div>
                  {idx < steps.length - 1 && <div className="w-4 h-[2px] bg-slate-100 mx-1" />}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => handleAction("auth")}
              disabled={loading || isAuthPolling}
              className="group relative overflow-hidden bg-orange-500 hover:bg-orange-600 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-orange-200 active:scale-95 disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                AUTHENTICATE
              </span>
            </button>
            <button
              onClick={() => handleAction("discover")}
              disabled={loading || isAuthPolling}
              className="group relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-blue-200 active:scale-95 disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                DISCOVER
              </span>
            </button>
            <button
              onClick={() => handleAction("filter")}
              disabled={loading || isAuthPolling}
              className="group relative overflow-hidden bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-emerald-200 active:scale-95 disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                FILTER ACTIVE
              </span>
            </button>
            <button
              onClick={() => handleAction("plan", "GET")}
              disabled={loading || isAuthPolling}
              className="group relative overflow-hidden bg-purple-600 hover:bg-purple-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-purple-200 active:scale-95 disabled:opacity-50"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                VIEW PLAN
              </span>
            </button>
          </div>
        </section>

        {/* Focused Output Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3 bg-blue-600 text-white px-5 py-3 rounded-xl shadow-md">
            <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-bold tracking-wide">{status || "Ready to begin landing zone discovery."}</span>
          </div>

          <div className="transition-all duration-500 ease-in-out">
            {/* AUTH VIEW */}
            {viewMode === "auth" && (
              <div className="bg-white p-12 rounded-2xl shadow-sm border border-orange-100 flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in duration-300">
                <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
                <h2 className="text-xl font-bold text-slate-800">Authentication Context</h2>
                <p className="max-w-md text-slate-500 text-sm leading-relaxed">
                  Initializing secure session with Google Cloud. We use service account impersonation to ensure high security without storing keys.
                </p>
                <div className="bg-orange-50 px-4 py-2 rounded-lg border border-orange-100">
                  <span className="text-xs font-mono text-orange-700">{status}</span>
                </div>
              </div>
            )}

            {/* DISCOVERED VIEW */}
            {viewMode === "discovered" && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-blue-500 rounded-full" />
                    Discovery Results
                  </h2>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{Object.keys(resources).length} Service Types Found</span>
                </div>
                {Object.entries(resources).map(([service, rows]) => {
                  const isExpanded = expandedSections[service];
                  return (
                    <div key={service} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden transition-all duration-200">
                      <div 
                        className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => toggleSection(service)}
                      >
                        <h3 className="text-xs font-black text-blue-600 uppercase tracking-widest">{service}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500">
                            {rows.length > 0 ? rows.length - 1 : 0} Resources
                          </span>
                          <svg className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="overflow-x-auto animate-in fade-in slide-in-from-top-2 duration-200">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-white text-slate-400 border-b border-slate-50">
                              <tr>
                                {rows[0]?.map((col, i) => (
                                  <th key={i} className="px-6 py-4 font-bold uppercase tracking-wider">{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {rows.slice(1).map((row, i) => (
                                <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                                  {row.map((cell, j) => (
                                    <td key={j} className="px-6 py-4 text-slate-600 font-mono leading-relaxed">{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ACTIVE VIEW */}
            {viewMode === "active" && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                 <div className="flex flex-col md:flex-row md:items-center justify-between px-2 gap-4">
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-emerald-500 rounded-full" />
                    Infrastructure Usage Analysis
                  </h2>
                  
                  {/* BULK UPDATE & ADD RESOURCE */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100">
                      <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Bulk Update</span>
                      <select
                        className="bg-white border border-slate-200 text-xs px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 min-w-[120px]"
                        value={bulkRegion}
                        onChange={(e) => setBulkRegion(e.target.value)}
                      >
                        <option value="">Set Region...</option>
                        {GCP_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <input
                        type="text"
                        placeholder="Set Subnet CIDR..."
                        list="subnet-presets"
                        value={bulkSubnet}
                        onChange={(e) => setBulkSubnet(e.target.value)}
                        className="w-[120px] bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-emerald-700"
                      />
                      <datalist id="subnet-presets">
                        <option value="10.0.0.0/24" />
                        <option value="10.1.1.0/26" />
                        <option value="10.1.2.0/26" />
                        <option value="10.1.5.0/26" />
                        <option value="10.1.10.0/26" />
                        <option value="10.2.1.0/26" />
                      </datalist>
                      <button
                        onClick={applyBulkUpdate}
                        disabled={!bulkRegion && !bulkSubnet}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded text-xs font-bold transition-all disabled:opacity-50"
                      >
                        Apply All
                      </button>
                    </div>

                    <select 
                      className="bg-white border border-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 min-w-[180px]"
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const [svc, rowIdx] = e.target.value.split("::");
                        if (resources[svc] && resources[svc][Number(rowIdx)]) {
                           addActiveResource(svc, resources[svc][Number(rowIdx)]);
                        }
                        e.target.value = ""; // reset
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>+ Add from Discover...</option>
                      {Object.entries(resources).map(([svc, rows]) => (
                         <optgroup key={svc} label={svc}>
                           {rows.slice(1).map((row, i) => (
                             <option key={`${svc}::${i+1}`} value={`${svc}::${i+1}`}>
                               {row[0]}
                             </option>
                           ))}
                         </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
                {Object.entries(activeResources).map(([service, rows]) => {
                  const sectionKey = `active_${service}`;
                  const isExpanded = expandedSections[sectionKey];
                  return (
                    <div key={service} className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden transition-all duration-200">
                      <div 
                        className="bg-emerald-50 px-6 py-3 border-b border-emerald-100 flex justify-between items-center cursor-pointer hover:bg-emerald-100/50 transition-colors"
                        onClick={() => toggleSection(sectionKey)}
                      >
                        <h3 className="text-xs font-black text-emerald-700 uppercase tracking-widest">{service}</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded border border-emerald-200 text-emerald-600 italic">
                            Verified Active
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); removeActiveService(service); }}
                            className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors ml-2"
                            title="Remove entire service category"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          <svg className={`w-4 h-4 text-emerald-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="overflow-x-auto animate-in fade-in slide-in-from-top-2 duration-200">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-white text-slate-400 border-b border-slate-50">
                              <tr>
                                {rows[0]?.map((col, i) => (
                                  <th key={i} className="px-6 py-4 font-bold uppercase tracking-wider">{col}</th>
                                ))}
                                <th className="px-6 py-4 font-bold uppercase tracking-wider text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {rows.slice(1).map((row, i) => (
                                <tr key={i} className="hover:bg-emerald-50/30 transition-colors">
                                  {row.map((cell, j) => {
                                    const headerName = rows[0][j];
                                    if (headerName === "NewRegion") {
                                      return (
                                        <td key={j} className="px-6 py-4">
                                          <select
                                            value={cell}
                                            onChange={(e) => updateActiveResource(service, i + 1, j, e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-emerald-700"
                                          >
                                            <option value="">Original</option>
                                            {GCP_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                          </select>
                                        </td>
                                      )
                                    }
                                    if (headerName === "NewSubnet") {
                                      return (
                                        <td key={j} className="px-6 py-4">
                                          <input 
                                            type="text" 
                                            value={cell} 
                                            list="subnet-presets"
                                            onChange={(e) => updateActiveResource(service, i + 1, j, e.target.value)}
                                            placeholder={`Enter ${headerName}`}
                                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-emerald-700"
                                          />
                                        </td>
                                      )
                                    }
                                    return (
                                      <td
                                        key={j}
                                        className={`px-6 py-4 font-mono leading-relaxed ${
                                          cell === "High" ? "text-orange-600 font-bold" : 
                                          cell === "Normal" ? "text-blue-600" : "text-slate-500"
                                        }`}
                                      >
                                        {cell}
                                      </td>
                                    )
                                  })}
                                  <td className="px-6 py-4 text-right">
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); removeActiveResource(service, i + 1); }}
                                      className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                                      title="Remove resource"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* PLAN VIEW */}
            {viewMode === "plan" && (
              <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden animate-in zoom-in-95 duration-500">
                <div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest ml-4">Terraform Plan Preview</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2 py-1 rounded">FAST Blueprint V34.1.0</span>
                  </div>
                </div>
                <div className="p-8 overflow-x-auto max-h-[600px] custom-scrollbar">
                  <pre className="text-[11px] font-mono text-emerald-400/90 whitespace-pre leading-loose">
                    {planOutput || "Analyzing infrastructure state..."}
                  </pre>
                </div>
              </div>
            )}

            {viewMode === "none" && (
              <div className="bg-white p-20 rounded-2xl border-2 border-dashed border-blue-100 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-300">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Ready to start discovery</h3>
                  <p className="text-sm text-slate-400 max-w-xs mx-auto mt-1">Begin by authenticating with your GCP project to scan for resources.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </main>
  );
}