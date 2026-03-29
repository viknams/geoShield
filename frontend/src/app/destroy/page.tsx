"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function DestroyPage() {
	const [projectID, setProjectID] = useState("");
	const [status, setStatus] = useState(
		"Loading managed resources...",
	);
	const [destroyOutput, setDestroyOutput] = useState("");
	const [managedResources, setManagedResources] = useState<
		Record<string, string[][]>
	>({});
	const [resourcesToDestroy, setResourcesToDestroy] = useState<
		Record<string, string[][]>
	>({});
	const [loading, setLoading] = useState(false);
	const [expandedSections, setExpandedSections] = useState<
		Record<string, boolean>
	>({});

	const searchParams = useSearchParams();

	const toggleSection = (sectionKey: string) => {
		setExpandedSections((prev) => ({
			...prev,
			[sectionKey]: !prev[sectionKey],
		}));
	};

	const apiCall = async (
		endpoint: string,
		method = "POST",
		bodyData?: any,
	) => {
		if (!projectID) {
			setStatus("Error: Project ID is required.");
			return;
		}
		setLoading(true);
		setStatus(`Executing ${endpoint}...`);
		try {
			const options: RequestInit = { method };
			if (bodyData) {
				options.headers = { "Content-Type": "application/json" };
				options.body = JSON.stringify(bodyData);
			}
			const res = await fetch(
				`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/${endpoint}?project=${projectID}`,
				options,
			);
			const data = await res.json();
			if (data.error) throw new Error(data.error);

			if (endpoint === "managed-resources") {
				setManagedResources(data);
				setStatus("Managed resources loaded successfully.");
			} else if (endpoint === "destroy") {
				setDestroyOutput(data.destroy_output);
				setStatus("Infrastructure destroy completed successfully.");
			}
		} catch (err: any) {
			setStatus(`Error: ${err.message}`);
		}
		setLoading(false);
	};

	useEffect(() => {
		const project = searchParams.get("project");
		if (project) {
			setProjectID(project);
		} else {
			setStatus("Error: No Project ID provided in the URL.");
		}
	}, [searchParams]);

	useEffect(() => {
		if (projectID) {
			apiCall("managed-resources", "GET");
		}
	}, [projectID]);

	if (destroyOutput) {
		return (
			<main className="min-h-screen bg-slate-900 text-slate-300 p-4 md:p-8 font-sans">
				<div className="max-w-6xl mx-auto space-y-6">
					<div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex gap-1.5">
								<div className="w-3 h-3 rounded-full bg-red-500" />
								<div className="w-3 h-3 rounded-full bg-yellow-500" />
								<div className="w-3 h-3 rounded-full bg-green-500" />
							</div>
							<span className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">
								Terraform Destroy Complete
							</span>
						</div>
						<Link href={`/?project=${projectID}`} className="text-xs text-blue-400 hover:underline">
							&larr; Back to Main
						</Link>
					</div>
					<div className="p-8 overflow-x-auto max-h-[80vh] custom-scrollbar">
						<pre className="text-[11px] font-mono text-slate-300 whitespace-pre leading-loose">
							{destroyOutput}
						</pre>
					</div>
				</div>
			</main>
		);
	}

	return (
		<main className="min-h-screen bg-gray-50 text-slate-900 p-4 md:p-8 font-sans">
			<div className="max-w-6xl mx-auto space-y-6">
				<header className="flex items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
					<div>
						<h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">
							Destroy Resources
						</h1>
						<p className="text-sm text-slate-500 font-medium">
							Decommission infrastructure managed by GeoShield.
						</p>
					</div>
					<Link
						href={`/?project=${projectID}`}
						className="text-sm font-bold text-blue-600 hover:underline"
					>
						&larr; Back to Main Control Plane
					</Link>
				</header>

				<section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
					<div className="flex-1 space-y-2">
						<label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
							GCP Project
						</label>
						<input
							type="text"
							value={projectID}
							onChange={(e) => setProjectID(e.target.value)}
							placeholder="Enter Project ID to load managed resources..."
							className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all font-mono text-blue-700"
						/>
					</div>
				</section>

				<section className="space-y-4">
					<div className="flex items-center justify-between px-2">
						<div className="flex items-center gap-3 bg-white text-slate-600 px-5 py-3 rounded-xl shadow-sm border border-slate-100">
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
							<span className="text-sm font-bold tracking-wide">{status}</span>
						</div>
						<button
							onClick={() =>
								apiCall("destroy", "POST", { resources: resourcesToDestroy })
							}
							disabled={loading || Object.keys(resourcesToDestroy).length === 0}
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
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
							Destroy Selected (
							{Object.values(resourcesToDestroy).reduce(
								(acc, rows) => acc + rows.length - 1,
								0,
							)}
							)
						</button>
					</div>

					<div className="space-y-6">
						{Object.entries(managedResources).map(([service, rows]) => {
							const isExpanded = expandedSections[service] ?? true;
							return (
								<div
									key={service}
									className="bg-white rounded-2xl shadow-sm border border-slate-100 transition-all duration-200"
								>
									<div
										className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
										onClick={() => toggleSection(service)}
									>
										<h3 className="text-xs font-black text-gray-600 uppercase tracking-widest">
											{service}
										</h3>
										<div className="flex items-center gap-3">
											<span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-500">
												{rows.length > 0 ? rows.length - 1 : 0} Managed
											</span>
											<svg
												className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
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
										<div className="overflow-x-auto">
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
															className="hover:bg-gray-50/50 transition-colors"
														>
															<td className="px-6 py-4">
																<input
																	type="checkbox"
																	className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
																	onChange={(e) => {
																		const terraformName = row[1];
																		setResourcesToDestroy((prev) => {
																			const updated = { ...prev };
																			if (e.target.checked) {
																				if (!updated[service]) {
																					updated[service] = [rows[0]]; // Add header
																				}
																				updated[service] = [
																					...updated[service],
																					row,
																				];
																			} else {
																				updated[service] = updated[
																					service
																				].filter(
																					(r) => r[1] !== terraformName,
																				);
																				if (updated[service].length <= 1) {
																					delete updated[service];
																				}
																			}
																			return updated;
																		});
																	}}
																/>
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
				</section>
			</div>
		</main>
	);
}