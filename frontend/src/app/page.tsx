"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
const GCP_REGIONS = [
	"asia-east1",
	"asia-east2",
	"asia-northeast1",
	"asia-northeast2",
	"asia-northeast3",
	"asia-south1",
	"asia-south2",
	"asia-southeast1",
	"asia-southeast2",
	"australia-southeast1",
	"australia-southeast2",
	"europe-central2",
	"europe-north1",
	"europe-southwest1",
	"europe-west1",
	"europe-west2",
	"europe-west3",
	"europe-west4",
	"europe-west6",
	"europe-west8",
	"europe-west9",
	"me-west1",
	"northamerica-northeast1",
	"northamerica-northeast2",
	"southamerica-east1",
	"southamerica-west1",
	"us-central1",
	"us-east1",
	"us-east4",
	"us-east5",
	"us-west1",
	"us-west2",
	"us-west3",
	"us-west4",
];

export default function HomePage() {
	const searchParams = useSearchParams();
	const [projectID, setProjectID] = useState("");
	const [status, setStatus] = useState("");
	const [planOutput, setPlanOutput] = useState("");
	const [applyOutput, setApplyOutput] = useState("");
	const [workspaceId, setWorkspaceId] = useState("");
	const [resources, setResources] = useState<Record<string, string[][]>>({});
	const [activeResources, setActiveResources] = useState<
		Record<string, string[][]>
	>({});
	const [viewMode, setViewMode] = useState<
		"none" | "auth" | "discovered" | "active" | "plan" | "apply"
	>("none");
	const [loading, setLoading] = useState(false);
	const [isAuthPolling, setIsAuthPolling] = useState(false);
	const [isFilterPolling, setIsFilterPolling] = useState(false);
	const [isPlanPolling, setIsPlanPolling] = useState(false);
	const [isApplyPolling, setIsApplyPolling] = useState(false);
	const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

	const [bulkRegion, setBulkRegion] = useState("");
	const [bulkSubnet, setBulkSubnet] = useState("");

	const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);
	const [addResourceSearch, setAddResourceSearch] = useState("");
	const addResourceRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	const toggleSection = (sectionKey: string) => {
		setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
	};

	const fetchResources = async () => {
		try {
			const res = await fetch(
				`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/resources?project=${projectID}`,
			);
			const data = await res.json();
			setResources(data);
		} catch (e) {
			console.error("Failed to fetch resources", e);
		}
	};

	const fetchActiveResources = async () => {
		try {
			const res = await fetch(
				`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/resources/active?project=${projectID}`,
			);
			const data = await res.json();
			if (data && !data.error) {
				setActiveResources(data);
				// Ensure NewRegion and NewSubnet columns exist
				for (const key in data) {
					const rows = data[key];
					if (rows.length > 0) {
						const header = rows[0];
						if (!header.includes("NewRegion")) {
							header.push("NewRegion");
							for (let i = 1; i < rows.length; i++) rows[i].push("");
						}
						if (!header.includes("NewSubnet")) {
							header.push("NewSubnet");
							for (let i = 1; i < rows.length; i++) rows[i].push("");
						}
					}
				}
			} else {
				setActiveResources({});
			}
		} catch (e) {
			console.error("Failed to fetch active resources", e);
		}
	};

	const addActiveResource = (serviceKey: string, row: string[]) => {
		setActiveResources((prev) => {
			const updated = { ...prev };
			let header;
			if (!updated[serviceKey]) {
				// If the service doesn't exist in active, create it with a proper header
				header = [...(resources[serviceKey]?.[0] || [])];
				if (!header.includes("NewRegion")) header.push("NewRegion");
				if (!header.includes("NewSubnet")) header.push("NewSubnet");
				updated[serviceKey] = [header];
			} else {
				header = updated[serviceKey][0];
			}

			// Avoid adding duplicates
			const exists = updated[serviceKey].some(
				(existingRow) => existingRow[0] === row[0],
			);
			if (!exists) {
				const newRow = [...row];
				while (newRow.length < header.length) newRow.push(""); // Ensure row has all columns
				updated[serviceKey] = [...updated[serviceKey], newRow];
			}
			return updated;
		});
	};

	const removeActiveResource = (serviceKey: string, rowIndex: number) => {
		setActiveResources((prev) => {
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
		setActiveResources((prev) => {
			const updated = { ...prev };
			delete updated[serviceKey];
			return updated;
		});
	};

	const updateActiveResource = (
		serviceKey: string,
		rowIndex: number,
		colIndex: number,
		value: string,
	) => {
		setActiveResources((prev) => {
			const updated = { ...prev };
			const rows = [...(updated[serviceKey] || [])];
			if (rows[rowIndex] && rows[rowIndex][colIndex] !== undefined) {
				const newRow = [...rows[rowIndex]];
				newRow[colIndex] = value;
				rows[rowIndex] = newRow;
				updated[serviceKey] = rows;
			}
			return updated;
		});
	};

	const applyBulkUpdate = () => {
		setActiveResources((prev) => {
			const updated = { ...prev };
			for (const serviceKey in updated) {
				const header = updated[serviceKey][0];
				const regionCol = header.indexOf("NewRegion");
				const subnetCol = header.indexOf("NewSubnet");

				if (regionCol === -1 && subnetCol === -1) continue;

				updated[serviceKey] = updated[serviceKey].map((row, i) => {
					if (i === 0) return row; // Skip header
					const newRow = [...row];
					if (bulkRegion && regionCol !== -1) {
						newRow[regionCol] = bulkRegion;
					}
					if (bulkSubnet && subnetCol !== -1) {
						newRow[subnetCol] = bulkSubnet;
					}
					return newRow;
				});
			}
			return updated;
		});
		setBulkRegion("");
		setBulkSubnet("");
	};

	const handleAction = async (
		endpoint: string,
		method: "GET" | "POST" = "POST",
	) => {
		if (!projectID) {
			setStatus("Error: Project ID is required.");
			return;
		}

		if (endpoint === "plan" || endpoint === "apply") {
			const payload = {
				resources: activeResources,
				workspaceId: workspaceId, // Will be empty for 'plan', populated for 'apply'
			};
			await apiCall(endpoint, "POST", payload);
		} else {
			await apiCall(endpoint, method);
		}
	};

	const apiCall = async (endpoint: string, method: string, bodyData?: any) => {
		setLoading(true);
		setStatus(`Executing ${endpoint}...`);

		abortControllerRef.current = new AbortController();
		const signal = abortControllerRef.current.signal;

		try {
			const options: RequestInit = { method, signal };
			if (bodyData) {
				options.headers = { "Content-Type": "application/json" };
				options.body = JSON.stringify(bodyData);
			}
			const res = await fetch(
				`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/${endpoint}?project=${projectID}`,
				options,
			);

			// If the request was aborted, don't process the response.
			if (signal.aborted) return;

			const data = await res.json();
			if (data.error) throw new Error(data.error);

			if (endpoint === "apply") {
				setStatus("Apply process started.");
				setIsApplyPolling(true);
			} else if (endpoint === "auth") {
				setStatus(data.status);
				setViewMode("auth");
				setIsAuthPolling(true);
			} else if (endpoint === "discover") {
				setStatus("Discovery complete. Fetching resources...");
				await fetchResources();
				setViewMode("discovered");
			} else if (endpoint === "filter") {
				setStatus("Filter process started.");
				setIsFilterPolling(true);
			} else if (endpoint === "plan") {
				setStatus("Plan process started.");
				setIsPlanPolling(true);
			} else {
				setStatus(data.status);
			}
		} catch (err: any) {
			if (err.name === "AbortError") {
				console.log("Fetch aborted by user.");
				setStatus("Operation cancelled.");
				setLoading(false);
				return;
			}
			setStatus(`Error: ${err.message}`);
			setLoading(false); // Ensure loading is stopped on any error
		}
		// For polling operations, the useEffect hook will set loading to false.
		if (endpoint !== "filter" && endpoint !== "auth" && endpoint !== "plan" && endpoint !== "apply" && endpoint !== "migrate" && endpoint !== "unlock") {
			setLoading(false);
		}
	};

	// Poll for auth status
	useEffect(() => {
		let interval: NodeJS.Timeout;
		if (isAuthPolling) {
			interval = setInterval(async () => {
				try {
					const res = await fetch(
						`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/auth/status`,
					);
					const data = await res.json();
					setStatus(data.status);
					if (data.status === "Completed") {
						setLoading(false);
						setIsAuthPolling(false);
						setViewMode("auth");
					}
				} catch (e) {
					console.error("Polling failed", e);
					setIsAuthPolling(false);
				}
			}, 2000);
		}
		return () => clearInterval(interval);
	}, [isAuthPolling]);

	// Poll for filter status
	useEffect(() => {
		let interval: NodeJS.Timeout;
		if (isFilterPolling) {
			interval = setInterval(async () => {
				try {
					const res = await fetch(
						`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/filter/status`,
					);
					const data = await res.json();
					setStatus(data.status);
					if (data.status === "Filter process completed.") {
						setLoading(false);
						setIsFilterPolling(false);
						await fetchActiveResources();
						setViewMode("active");
					}
				} catch (e) {
					console.error("Polling failed", e);
					setIsFilterPolling(false);
				}
			}, 1000);
		}
		return () => clearInterval(interval);
	}, [isFilterPolling]);

	// Poll for plan status
	useEffect(() => {
		let interval: NodeJS.Timeout;
		if (isPlanPolling) {
			interval = setInterval(async () => {
				try {
					const res = await fetch(
						`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/plan/status`,
					);
					const data = await res.json();

					if (data.status.startsWith("COMPLETED::")) {
						const parts = data.status.split("::");
						const newWorkspaceId = parts[1];
						const finalPlanOutput = parts[2];
						setWorkspaceId(newWorkspaceId);
						setPlanOutput(finalPlanOutput);
						setStatus("Infrastructure plan generated successfully.");
						setLoading(false);
						setIsPlanPolling(false);
						setViewMode("plan");
					} else {
						setStatus(data.status);
					}
				} catch (e) {
					console.error("Polling failed", e);
					setIsPlanPolling(false);
				}
			}, 1000);
		}
		return () => clearInterval(interval);
	}, [isPlanPolling]);

	// Poll for apply status
	useEffect(() => {
		let interval: NodeJS.Timeout;
		if (isApplyPolling) {
			interval = setInterval(async () => {
				try {
					const res = await fetch(
						`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/plan/status`,
					);
					const data = await res.json();
					if (data.status.startsWith("APPLY_COMPLETED::")) {
						const finalApplyOutput = data.status.substring("APPLY_COMPLETED::".length);
						setApplyOutput(finalApplyOutput);
						setStatus("Infrastructure apply completed successfully.");
						setLoading(false);
						setIsApplyPolling(false);
						setViewMode("apply");
					} else {
						setStatus(data.status);
					}
				} catch (e) {
					console.error("Polling failed", e);
					setIsApplyPolling(false); // Stop polling on error
					setLoading(false);
				}
			}, 1000);
		}
		return () => clearInterval(interval);
	}, [isApplyPolling]);

	// Clear session cache when project changes
	useEffect(() => {
		setPlanOutput("");
		setApplyOutput("");
		setResources({});
		setActiveResources({});
		setStatus("");
		setViewMode("none");
		setExpandedSections({});
	}, [projectID]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				addResourceRef.current &&
				!addResourceRef.current.contains(event.target as Node)
			) {
				setIsAddResourceOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [addResourceRef]);

	useEffect(() => {
		const project = searchParams.get("project");
		if (project && !projectID) {
			setProjectID(project);
		}
		// We only want this to run once on load when a project is in the URL
	}, [searchParams]);

	const steps = [
		{ id: "auth", label: "Auth", color: "bg-orange-500" },
		{ id: "discovered", label: "Discover", color: "bg-blue-500" },
		{ id: "active", label: "Filter", color: "bg-emerald-500" },
		{ id: "plan", label: "Plan", color: "bg-purple-500" },
		{ id: "apply", label: "Apply", color: "bg-red-500" },
	];

	return (
		<main className="min-h-screen bg-gray-50 text-slate-900 p-4 md:p-8 font-sans">
			{loading && (
				<div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center animate-in fade-in duration-300">
					<div className="flex items-center gap-3 text-white p-4 rounded-lg">
						<svg className="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 20v-5h-5" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 12a8 8 0 018-8h.5" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12a8 8 0 01-8 8h-.5" /></svg>
						<span className="text-lg font-bold">{status}</span>
					</div>
					<button
						onClick={() => abortControllerRef.current?.abort()}
						className="mt-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all"
					>
						Cancel
					</button>
				</div>
			)}

			<div className="max-w-7xl mx-auto space-y-8">
				<header className="flex flex-col md:flex-row items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<svg
							className="w-10 h-10 text-blue-600"
							viewBox="0 0 24 24"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M12 2L2 7V17L12 22L22 17V7L12 2Z"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinejoin="round"
							/>
							<path
								d="M2 7L12 12L22 7"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinejoin="round"
							/>
							<path
								d="M12 22V12"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinejoin="round"
							/>
						</svg>
						<div>
							<h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">
								GeoShield
							</h1>
							<p className="text-sm text-slate-500 font-medium whitespace-nowrap">
								Cloud Landing Zone Provisioner
							</p>
						</div>
					</div>
					<div className="w-full md:flex-1 md:max-w-md">
						<input
							type="text"
							value={projectID}
							onChange={(e) => setProjectID(e.target.value)}
							placeholder="Enter your GCP Project ID..."
							className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono text-blue-700"
						/>
					</div>
				</header>

				<section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
					<div className="flex flex-col md:flex-row items-center justify-between gap-4">
						<div className="flex items-center gap-3 bg-slate-50 text-slate-600 px-5 py-3 rounded-xl shadow-sm border border-slate-100">
							<svg
								className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
									d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<span className="text-sm font-bold tracking-wide">
								{status || "Ready"}
							</span>
						</div>
						<div className="flex items-center gap-2 overflow-x-auto p-2">
							{steps.map((step, i) => (
								<div key={step.id} className="flex items-center">
									<button
										onClick={() => {
											if (step.id === "plan" && planOutput) setViewMode("plan");
											else if (step.id === "apply" && applyOutput)
												setViewMode("apply");
											else if (
												step.id === "discovered" &&
												Object.keys(resources).length > 0
											)
												setViewMode("discovered");
											else if (
												step.id === "active" &&
												Object.keys(activeResources).length > 0
											)
												setViewMode("active");
											else if (
												step.id === "auth" &&
												status.includes("successful")
											)
												setViewMode("auth");
										}}
										className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm transition-all ${step.color} ${viewMode === step.id ? "ring-2 ring-offset-2 ring-current" : "opacity-50 hover:opacity-100"}`}
									>
										{i + 1}
									</button>
									<span className="hidden md:inline text-xs font-bold text-slate-500 ml-2 mr-4 whitespace-nowrap">
										{step.label}
									</span>
									{i < steps.length - 1 && (
										<div className="w-12 h-0.5 bg-slate-200" />
									)}
								</div>
							))}
						</div>
					</div>

					<div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
						<button
							onClick={() => handleAction("auth", "POST")}
							disabled={loading || isAuthPolling || isFilterPolling}
							className="group relative overflow-hidden bg-orange-500 hover:bg-orange-600 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-orange-200 active:scale-95 disabled:opacity-50"
						>
							<span className="relative z-10 flex items-center justify-center gap-2">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
									/>
								</svg>
								AUTH
							</span>
						</button>
						<button
							onClick={() => handleAction("discover", "POST")}
							disabled={loading || isAuthPolling || isFilterPolling}
							className="group relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-blue-200 active:scale-95 disabled:opacity-50"
						>
							<span className="relative z-10 flex items-center justify-center gap-2">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
									/>
								</svg>
								DISCOVER
							</span>
						</button>
						<button
							onClick={() => handleAction("filter", "POST")}
							disabled={loading || isAuthPolling || isFilterPolling}
							className="group relative overflow-hidden bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-emerald-200 active:scale-95 disabled:opacity-50"
						>
							<span className="relative z-10 flex items-center justify-center gap-2">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L12 14.414V19a1 1 0 01-1.447.894L7 18.118V14.414L3.293 6.707A1 1 0 013 6V4z" />
								</svg>
								FILTER
							</span>
						</button>
						<button
							onClick={() => handleAction("plan", "POST")}
							disabled={loading || isAuthPolling || isFilterPolling}
							className="group relative overflow-hidden bg-purple-600 hover:bg-purple-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-purple-200 active:scale-95 disabled:opacity-50"
						>
							<span className="relative z-10 flex items-center justify-center gap-2">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
								VIEW PLAN
							</span>
						</button>
						<button
							onClick={() => handleAction("migrate", "POST")}
							disabled={loading || isAuthPolling || isFilterPolling}
							className="group relative overflow-hidden bg-teal-600 hover:bg-teal-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-teal-200 active:scale-95 disabled:opacity-50"
						>
							<span className="relative z-10 flex items-center justify-center gap-2">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
								</svg>
								APP MIGRATION
							</span>
						</button>
						<Link
							href={projectID ? `/destroy?project=${projectID}` : "#"}
							className="lg:col-start-6 h-full"
						>
							<button
								disabled={loading || isAuthPolling || isFilterPolling || !projectID}
								className="w-full h-full group relative overflow-hidden bg-gray-600 hover:bg-gray-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-gray-200 active:scale-95 disabled:opacity-50"
							>
								<span className="relative z-10 flex items-center justify-center gap-2">
									<svg
										className="w-5 h-5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
									DESTROY
								</span>
							</button>
						</Link>
						<Link
							href={projectID ? `/message?project=${projectID}` : "#"}
							className="lg:col-start-1 h-full"
						>
							<button
								disabled={loading || isAuthPolling || isFilterPolling || !projectID}
								className="w-full h-full group relative overflow-hidden bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-cyan-200 active:scale-95 disabled:opacity-50"
							>
								<span className="relative z-10 flex items-center justify-center gap-2">
									<svg
										className="w-5 h-5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
									</svg>
									MESSAGES
								</span>
							</button>
						</Link>
					</div>
				</section>

				<section className="pt-4">
					{/* DISCOVERED VIEW */}
					{viewMode === "discovered" && (
						<div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
							<div className="px-2">
								<h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
									<span className="w-1.5 h-6 bg-blue-500 rounded-full" />
									Discovery Results
								</h2>
							</div>
							{Object.entries(resources).map(([service, rows]) => {
								const sectionKey = `discovered_${service}`;
								const isExpanded = expandedSections[sectionKey] ?? false;
								return (
									<div
										key={service}
										className="bg-white rounded-2xl shadow-sm border border-blue-100 overflow-hidden transition-all duration-200"
									>
										<div
											className="bg-blue-50 px-6 py-3 border-b border-blue-100 flex justify-between items-center cursor-pointer hover:bg-blue-100/50 transition-colors"
											onClick={() => toggleSection(sectionKey)}
										>
											<h3 className="text-xs font-black text-blue-600 uppercase tracking-widest">
												{service}
											</h3>
											<div className="flex items-center gap-3">
												<span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded border border-blue-200 text-blue-500">
													{rows.length > 0 ? rows.length - 1 : 0} Found
												</span>
												<svg
													className={`w-4 h-4 text-blue-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth="2"
														d="M19 9l-7 7-7-7"
													/>
												</svg>
											</div>
										</div>
										{isExpanded && (
											<div className="overflow-x-auto animate-in fade-in slide-in-from-top-2 duration-200">
												<table className="w-full text-left text-xs">
													<thead className="bg-white text-slate-400 border-b border-slate-50">
														<tr>
															<th className="px-6 py-4"></th>
															{rows[0]?.map((col, i) => (
																<th
																	key={i}
																	className="px-6 py-4 font-bold uppercase tracking-wider"
																>
																	{col}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-50">
														{rows.slice(1).map((row, i) => (
															<tr
																key={i}
																className="hover:bg-blue-50/50 transition-colors"
															>
																<td className="px-6 py-4">
																	<button
																		onClick={() => addActiveResource(service, row)}
																		className="bg-blue-100 text-blue-600 hover:bg-blue-200 px-2 py-1 rounded text-[10px] font-bold"
																	>
																		+ Add
																	</button>
																</td>
																{row.map((cell, j) => (
																	<td
																		key={j}
																		className="px-6 py-4 text-slate-600 font-mono leading-relaxed"
																	>
																		{cell}
																	</td>
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
								<div className="flex items-center gap-2">
									<span className="w-1.5 h-6 bg-emerald-500 rounded-full" />
									<h2 className="text-lg font-bold text-slate-800">
										Active Resources
									</h2>
								</div>
								<div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-4">
									{/* --- Section 1: Add Resource --- */}
									<div className="space-y-2">
										<label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
											1. Add Resource
										</label>
										<div className="relative" ref={addResourceRef}>
											<button
												onClick={() => setIsAddResourceOpen(!isAddResourceOpen)}
												className="bg-white border border-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full flex items-center justify-between"
											>
												<span>+ Add from Discover...</span>
												<svg className="w-4 h-4 text-slate-400 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
											</button>
											{isAddResourceOpen && (
												<div className="absolute z-20 left-0 mt-2 w-full bg-white rounded-lg shadow-xl border border-slate-100">
													<div className="p-2">
														<input
															type="text"
															placeholder="Search resources..."
															value={addResourceSearch}
															onChange={(e) => setAddResourceSearch(e.target.value)}
															className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
														/>
													</div>
													<ul className="max-h-60 overflow-y-auto text-xs custom-scrollbar">
														{Object.entries(resources)
															.flatMap(([svc, rows]) =>
																rows.slice(1).map((row, i) => ({
																	svc,
																	row,
																	rowIdx: i + 1,
																}))
															)
															.filter(({ row }) =>
																row[0].toLowerCase().includes(addResourceSearch.toLowerCase())
															)
															.map(({ svc, row, rowIdx }) => (
																<li key={`${svc}::${rowIdx}`}>
																	<button
																		onClick={() => {
																			addActiveResource(svc, row);
																			setIsAddResourceOpen(false);
																			setAddResourceSearch("");
																		}}
																		className="w-full text-left px-4 py-2 hover:bg-emerald-50 transition-colors"
																	>
																		<span className="font-bold text-slate-700">{row[0]}</span>
																		<span className="text-slate-400 ml-2 text-[10px] uppercase">{svc}</span>
																	</button>
																</li>
															))}
													</ul>
												</div>
											)}
										</div>
									</div>

									{/* --- Section 2: Bulk Set Properties --- */}
									<div className="space-y-2">
										<label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
											2. Bulk Set Properties
										</label>
										<div className="flex flex-col md:flex-row gap-2">
											<select
												className="bg-white border border-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-1/2"
												value={bulkRegion}
												onChange={(e) => setBulkRegion(e.target.value)}
											>
												<option value="">Set Region...</option>
												{GCP_REGIONS.map((r) => (<option key={r} value={r}>{r}</option>))}
											</select>
											<input
												type="text"
												placeholder="Set Subnet CIDR..."
												list="subnet-presets"
												value={bulkSubnet}
												onChange={(e) => setBulkSubnet(e.target.value)}
												className="w-full sm:w-1/2 bg-white border border-slate-200 text-xs px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-emerald-700"
											/>
											<datalist id="subnet-presets">
												<option value="10.0.0.0/24" />
												<option value="10.1.1.0/26" />
												<option value="10.1.2.0/26" />
												<option value="10.1.5.0/26" />
												<option value="10.1.10.0/26" />
												<option value="10.2.1.0/26" />
											</datalist>
										</div>
									</div>

									{/* --- Section 3: Apply Bulk Actions --- */}
									<div className="space-y-2 flex flex-col justify-end">
										<label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 lg:invisible">
											3. Apply
										</label> 
										<button
											onClick={applyBulkUpdate}
											disabled={!bulkRegion && !bulkSubnet}
											className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 w-full"
										>
											Apply to All 
										</button>
									</div>
								</div>
							</div>
							{Object.entries(activeResources).map(([service, rows]) => {
								const sectionKey = `active_${service}`;
								const isExpanded = expandedSections[sectionKey];
								if (rows.length <= 1) {
									// Don't render if only header exists
									return null;
								}
								return (
									<div
										key={service}
										className="bg-white rounded-2xl shadow-sm border border-emerald-100 transition-all duration-200"
									>
										<div
											className="bg-emerald-50 px-6 py-3 border-b border-emerald-100 flex justify-between items-center cursor-pointer hover:bg-emerald-100/50 transition-colors"
											onClick={() => toggleSection(sectionKey)}
										>
											<h3 className="text-xs font-black text-emerald-700 uppercase tracking-widest">
												{service}
											</h3>
											<div className="flex items-center gap-3">
												<button
													onClick={(e) => {
														e.stopPropagation();
														removeActiveService(service);
													}}
													className="relative text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-100/50 transition-colors ml-2 group"
													data-tooltip="Remove entire service category"
												>
													<svg
														className="w-4 h-4"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															strokeLinecap="round"
															strokeLinejoin="round"
															strokeWidth="2"
															d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
														/>
													</svg>
												</button>
												<span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded border border-emerald-200 text-emerald-500">
													{rows.length > 0 ? rows.length - 1 : 0} To
													Provision
												</span>
												<svg
													className={`w-4 h-4 text-emerald-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth="2"
														d="M19 9l-7 7-7-7"
													/>
												</svg>
											</div>
										</div>
										{isExpanded && (
											<div className="overflow-x-auto animate-in fade-in slide-in-from-top-2 duration-200">
												<table className="w-full text-left text-xs">
													<thead className="bg-white text-slate-400 border-b border-slate-50">
														<tr>
															{rows[0]?.map((col, i) => {
																const isEditable =
																	col === "NewRegion" || col === "NewSubnet";
																return (
																	<th
																		key={i}
																		className={`px-6 py-4 font-bold uppercase tracking-wider ${isEditable ? "text-emerald-600" : ""}`}
																	>
																		{col}
																	</th>
																);
															})}
															<th className="px-6 py-4"></th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-50">
														{rows.slice(1).map((row, i) => (
															<tr
																key={i}
																className="hover:bg-emerald-50/50 transition-colors"
															>
																{row.map((cell, j) => {
																	const header = rows[0][j];
																	const isEditable =
																		header === "NewRegion" ||
																		header === "NewSubnet";
																	if (header === "NewRegion") {
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
																	if (header === "NewSubnet") {
																		return (
																			<td key={j} className="px-6 py-4">
																				<input
																					type="text"
																					value={cell}
																					list="subnet-presets"
																					onChange={(e) => updateActiveResource(service, i + 1, j, e.target.value)}
																					placeholder={`Enter ${header}`}
																					className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-emerald-700"
																				/>
																			</td>
																		)
																	}
																	return (
																		<td key={j} className={`px-6 py-4 font-mono leading-relaxed ${cell === "High" ? "text-orange-600 font-bold" : cell === "Normal" ? "text-blue-600" : "text-slate-500"}`}>
																			{cell}
																		</td>
																	)
																})}
																<td className="px-6 py-2 text-right">
																	<button
																		onClick={(e) => {
																			e.stopPropagation();
																			removeActiveResource(service, i + 1);
																		}}
																		className="relative text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-100/50 transition-colors group"
																		data-tooltip="Remove this resource from the plan"
																	>
																		<svg
																			className="w-4 h-4"
																			fill="none"
																			stroke="currentColor"
																			viewBox="0 0 24 24"
																		>
																			<path
																				strokeLinecap="round"
																				strokeLinejoin="round"
																				strokeWidth="2"
																				d="M6 18L18 6M6 6l12 12"
																			/>
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
									<span className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">
										Terraform Plan Preview
									</span>
								</div>
								<div className="flex items-center gap-2">
									<button
										onClick={() => setViewMode("active")}
										className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-xs font-bold transition-all"
									>
										&larr; Back to Edit
									</button>
									<button
										onClick={() => handleAction("apply")}
										disabled={loading}
										className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-bold transition-all disabled:opacity-50 active:scale-95 flex items-center gap-2"
									>
										<svg
											className="w-4 h-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth="2"
												d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
										APPLY PLAN
									</button>
								</div>
							</div>
							<div className="p-8 overflow-x-auto max-h-[600px] custom-scrollbar">
								<pre className="text-[11px] font-mono text-slate-300 whitespace-pre leading-loose">
									{planOutput}
								</pre>
							</div>
						</div>
					)}

					{/* APPLY VIEW */}
					{viewMode === "apply" && (
						<div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden animate-in zoom-in-95 duration-500">
							<div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
								<div className="flex items-center gap-3">
									<div className="flex gap-1.5">
										<div className="w-3 h-3 rounded-full bg-red-500" />
										<div className="w-3 h-3 rounded-full bg-yellow-500" />
										<div className="w-3 h-3 rounded-full bg-green-500" />
									</div>
									<span className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">
										Terraform Apply Complete
									</span>
								</div>
								<div className="flex items-center gap-2">
									<span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-2 py-1 rounded">
										Execution Finished
									</span>
								</div>
							</div>
							<div className="p-8 overflow-x-auto max-h-[600px] custom-scrollbar">
								<pre className="text-[11px] font-mono text-slate-300 whitespace-pre leading-loose">
									{applyOutput}
								</pre>
							</div>
						</div>
					)}

					{viewMode === "none" && (
						<div className="bg-white p-20 rounded-2xl border-2 border-dashed border-blue-100 flex flex-col items-center justify-center text-center space-y-4">
							<div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-300">
								<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
								</svg>
							</div>
							<h3 className="text-lg font-bold text-slate-700">
								Ready to Provision
							</h3>
							<p className="text-sm text-slate-500 max-w-md">
								Enter your GCP Project ID above and use the action buttons to
								begin discovering resources and building your infrastructure plan.
							</p>
						</div>
					)}
				</section>
			</div>
			<style jsx global>{`
				.custom-scrollbar::-webkit-scrollbar {
					width: 8px;
					height: 8px;
				}
				.custom-scrollbar::-webkit-scrollbar-track {
					background: rgba(255, 255, 255, 0.1);
					border-radius: 4px;
				}
				.custom-scrollbar::-webkit-scrollbar-thumb {
					background: rgba(255, 255, 255, 0.15);
					border-radius: 4px;
				}
				.custom-scrollbar::-webkit-scrollbar-thumb:hover {
					background: rgba(255, 255, 255, 0.2);
				}
				.group[data-tooltip]:hover::before,
				.group[data-tooltip]:hover::after {
					opacity: 1;
					transition: opacity 0.1s ease-in-out;
					pointer-events: none;
				}
				.group[data-tooltip]::before {
					content: attr(data-tooltip);
					position: absolute;
					bottom: 100%;
					left: 50%;
					transform: translateX(-50%) translateY(-8px);
					background-color: #1e293b; /* slate-800 */
					color: white;
					padding: 4px 8px;
					border-radius: 4px;
					font-size: 12px;
					white-space: nowrap;
					opacity: 0;
					z-index: 10; /* Ensure tooltip is on top */
				}
			`}</style>
		</main>
	);
}