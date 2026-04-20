"use client";

import { useState, useEffect, useRef, Suspense, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWebSocket } from "@/contexts/WebSocketContext";
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

export default function HomePageWrapper() {
	return (
		// Wrap the component that uses useSearchParams in a Suspense boundary
		<Suspense fallback={<HomePageLoading />}>
			<HomePageClient />
		</Suspense>
	);
}

// Custom hook for debouncing
function useDebounce<T>(value: T, delay: number): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value);

	useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedValue(value);
		}, delay);

		return () => {
			clearTimeout(handler);
		};
	}, [value, delay]);

	return debouncedValue;
}

// Helper function to create a stable, sorted JSON string for object comparison
function getCanonicalJson(obj: any): string {
	if (!obj || typeof obj !== 'object') {
		return JSON.stringify(obj);
	}
	// Create a new object with sorted keys to ensure consistent stringification
	const sortedObj = Object.keys(obj).sort().reduce((acc, key) => { acc[key] = obj[key]; return acc; }, {} as Record<string, any>);
	return JSON.stringify(sortedObj);
}

function HomePageClient() {
	const searchParams = useSearchParams();
	const [projectID, setProjectID] = useState("");
	const [status, setStatus] = useState("Ready");
	const [migrationStatus, setMigrationStatus] = useState("");
	const [cutoverStatus, setCutoverStatus] = useState("");
	const [planOutput, setPlanOutput] = useState("");
	const [applyOutput, setApplyOutput] = useState("");
	const [workspaceId, setWorkspaceId] = useState("");
	const [resources, setResources] = useState<Record<string, string[][]>>({});
	const [activeResources, setActiveResources] = useState<
		Record<string, string[][]>
	>({});
	const [resourcesToPlan, setResourcesToPlan] = useState<
		Record<string, string[][]>
	>({});
	const [viewMode, setViewMode] = useState<
		"none" | "auth" | "discovered" | "active" | "plan" | "apply" | "migrate"
	>("none");
	const [loading, setLoading] = useState(false);
	const [workflowMode, setWorkflowMode] = useState<"manual" | "auto">("manual");
	const [lastCompletedStep, setLastCompletedStep] = useState<string>("");
	const [riskChangeAlert, setRiskChangeAlert] = useState<string | null>(null);
	const [isAutomationRunning, setIsAutomationRunning] = useState(false);
	const [expandedSections, setExpandedSections] = useState<
		Record<string, boolean>
	>({});
	// State to store the latest risk message for prominent display
	const [latestRiskMessage, setLatestRiskMessage] = useState<{
		regionName: string;
		cloudProvider: string;
		id: string; // Cloud provider's region ID, e.g., us-east4
		previousRiskLevel: string;
		currentRiskLevel: string;
		time: string; // Timestamp from the message body
	} | null>({
		regionName: "Global",
		cloudProvider: "gcp",
		id: "global",
		previousRiskLevel: "N/A",
		currentRiskLevel: "R0", // Start at R0 by default
		time: new Date().toISOString(),
	});
	const [isLatestRiskLoading, setIsLatestRiskLoading] = useState(false);
	const [riskLevels, setRiskLevels] = useState<Record<string, { current: string; previous: string }>>({});
	const { connect, disconnect, ws, latestMessage: webSocketLatestMessage } = useWebSocket();
	const [hasMounted, setHasMounted] = useState(false); // For preventing hydration errors
	const [apiKey, setApiKey] = useState<string>("");
	const [discoveryMetadata, setDiscoveryMetadata] = useState<{
		last_run_at: string;
		user_id: string;
		status: string;
	} | null>(null);
	const [filterMetadata, setFilterMetadata] = useState<{
		last_filtered_at: string;
		user_id: string;
	} | null>(null);
	const [hasCachedPlan, setHasCachedPlan] = useState<boolean>(false);


	const [bulkRegion, setBulkRegion] = useState("");
	const [bulkSubnet, setBulkSubnet] = useState("");

	const [isAddResourceOpen, setIsAddResourceOpen] = useState(false);
	const [addResourceSearch, setAddResourceSearch] = useState("");
	const addResourceRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	// Load API key from session storage on mount
	useEffect(() => {
		// This effect runs once on initial mount to get the API key.
		const storedApiKey = sessionStorage.getItem("geoShieldApiKey");
		if (storedApiKey) {
			setApiKey(storedApiKey);
		}
		// Load last completed step from localStorage
		const storedLastStep = localStorage.getItem(`geoShieldLastStep_${projectID}`);
		if (storedLastStep) {
			setLastCompletedStep(storedLastStep);
		}
	}, []);

	// Save API key to session storage whenever it changes
	const handleApiKeyChange = (key: string) => {
		setApiKey(key);
		sessionStorage.setItem("geoShieldApiKey", key);
	};

	const toggleSection = (sectionKey: string) => {
		setExpandedSections((prev) => ({
			...prev,
			[sectionKey]: !prev[sectionKey],
		}));
	};

	const fetchResources = async () => {
		try {
			const data = await apiCall("resources", "GET");
			setResources(data.resources || {});
			setDiscoveryMetadata(data.metadata || null);
		} catch (e) {
			console.error("Failed to fetch resources", e);
			setResources({}); // Clear on failure
		}
	};

	const fetchActiveResources = async () => {
		try {
			const data = await apiCall("resources/active", "GET");
			if (data) {
				setActiveResources(data.active_resources || {});
				// Restore the user's previous selections
				const loadedResourcesToPlan = data.resources_to_plan || {};
				setResourcesToPlan(loadedResourcesToPlan);

				if (data.last_filtered_at && data.user_id) {
					setFilterMetadata({
						last_filtered_at: data.last_filtered_at,
						user_id: data.user_id,
					});
				} else {
					setFilterMetadata(null);
				}
			} else {
				setActiveResources({});
				setFilterMetadata(null);
			}
		} catch (e) {
			console.error("Failed to fetch active resources", e);
			setActiveResources({}); // Clear on failure
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
		const resourceToRemove = activeResources[serviceKey]?.[rowIndex];

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

		// Also remove it from the list of resources to be planned
		if (resourceToRemove) {
			const resourceName = resourceToRemove[0];
			setResourcesToPlan((prev) => {
				const updated = { ...prev };
				if (updated[serviceKey]) {
					updated[serviceKey] = updated[serviceKey].filter(
						(r) => r[0] !== resourceName,
					);
					if (updated[serviceKey].length <= 1) {
						// If only the header is left, remove the service key entirely
						delete updated[serviceKey];
					}
				}
				return updated;
			});
		}
	};

	const removeActiveService = (serviceKey: string) => {
		setActiveResources((prev) => {
			const updated = { ...prev };
			delete updated[serviceKey];
			return updated;
		});
		// Also remove the entire service from the list of resources to be planned
		setResourcesToPlan((prev) => {
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
		const currentServiceRows = activeResources[serviceKey];
		if (!currentServiceRows || rowIndex >= currentServiceRows.length || !currentServiceRows[rowIndex]) {
			console.warn("Attempted to update non-existent resource or index out of bounds.");
			return;
		}
		const resourceToIdentify = currentServiceRows[rowIndex][0]; // Get the resource name before any state update

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

		// Also update the same resource in resourcesToPlan if it's selected
		setResourcesToPlan(prev => {
			const updated = { ...prev };
			if (updated[serviceKey]) {
				const rowIndexInPlan = updated[serviceKey].findIndex(r => r[0] === resourceToIdentify);
				if (rowIndexInPlan !== -1) {
					const newRow = [...updated[serviceKey][rowIndexInPlan]];
					newRow[colIndex] = value;
					updated[serviceKey][rowIndexInPlan] = newRow;
				}
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

		// Also apply bulk update to selected resources
		setResourcesToPlan(prev => {
			const updated = { ...prev };
			for (const serviceKey in updated) {
				const header = updated[serviceKey][0];
				const regionCol = header.indexOf("NewRegion");
				const subnetCol = header.indexOf("NewSubnet");
				if (regionCol === -1 && subnetCol === -1) continue;

				updated[serviceKey] = updated[serviceKey].map((row, i) => {
					if (i === 0) return row; // Skip header
					const newRow = [...row];
					if (bulkRegion && regionCol !== -1) newRow[regionCol] = bulkRegion;
					if (bulkSubnet && subnetCol !== -1) newRow[subnetCol] = bulkSubnet;
					return newRow;
				});
			}
			return updated;
		});
		setBulkRegion("");
		setBulkSubnet("");
	};

	const apiCall = async (endpoint: string, method: string, bodyData?: any, signal?: AbortSignal, queryParams: string = "") => {
		try {
			if (!apiKey) {
				throw new Error("API Key is not set. Please enter your API Key.");
			}
			const options: RequestInit = { method, signal };
			options.headers = {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`, 
			};
			if (bodyData) options.body = JSON.stringify(bodyData);

			const res = await fetch(
				`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/${endpoint}?project=${projectID}${queryParams}`,
				options,
			);

			// Handle successful responses that don't have a body (e.g., 204 No Content)
			if (res.status === 204) {
				return null; // Or return a success indicator if needed
			}

			const data = await res.json();
			if (data.error) throw new Error(data.error);

			return data;

		} catch (err: any) {
			if (err.name === "AbortError") {
				console.log("Fetch aborted by user.");
				setStatus("Operation cancelled.");
				// Don't re-throw, as this is an expected user action, not a failure.
				// We return a resolved promise with an indicator.
				// The caller can decide how to handle it.
				return Promise.resolve({ aborted: true });
			} else {
				setStatus(`Error: ${err.message}`);
			}
			throw err; // Re-throw to be caught by automation engine
		}
	};

	// Clear session cache when project changes
	useEffect(() => {
		setPlanOutput("");
		setApplyOutput("");
		setResources({});
		// When project changes, clear the selected resources for planning
		setResourcesToPlan({});
		setActiveResources({});
		setStatus("");
		setViewMode("none");
		setExpandedSections({});
		setLastCompletedStep(""); // Clear automation progress on project change
		setRiskChangeAlert(null);
		setFilterMetadata(null);
		localStorage.removeItem(`geoShieldLastStep_${projectID}`);
		localStorage.removeItem(`geoShieldPlanCache_${projectID}`);
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

	const logToServer = useCallback((message: string, level: "info" | "warn" | "error" = "info") => {
		// Log to browser console for immediate debugging
		console.log(message);

		// Don't send log if api key or project id is not set, to avoid spamming errors
		if (!apiKey || !projectID) {
			return;
		}

		// Send log to backend without waiting for a response (fire and forget)
		fetch(
			`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/log?project=${projectID}`,
			{
				method: 'POST',
				headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
				body: JSON.stringify({ message, level }),
			}
		).catch(err => console.error("Failed to send log to server:", err)); // Log failure to console
	}, [apiKey, projectID]);

	// Effect to set mounted state. This prevents hydration errors with time formatting.
	useEffect(() => {
		setHasMounted(true);
	}, []);

	// Helper function to get Tailwind CSS class for risk level
	const getRiskColorClass = (riskLevel: string) => {
		if (!riskLevel) {
			return "text-slate-500";
		}
		switch (riskLevel) {
			case "R0":
			case "R1":
			case "R2":
				return "text-green-500";
			case "R3":
				return "text-orange-500";
			case "R4":
				return "text-red-500";
			case "R5":
				return "text-red-800"; // Dark Red
			default:
				return "text-slate-500"; // Default color
		}
	};

	const pollStatus = (statusUrl: string, completionPrefix: string, timeout: number, statusSetter: (status: string) => void) => {
		return new Promise<string>((resolve, reject) => {
			const startTime = Date.now();
			const signal = abortControllerRef.current?.signal;
			let intervalId: NodeJS.Timeout;

			const checkStatus = async () => {
				// Check if the signal exists and is aborted
				if (signal && signal.aborted) {
					clearInterval(intervalId);
					reject(new Error("Operation cancelled by user."));
					return;
				}

				// Ensure abortControllerRef.current is still the one associated with this poll
				// This helps prevent issues if a new operation starts while this one is still polling
				if (abortControllerRef.current?.signal !== signal) {
					clearInterval(intervalId);
					reject(new Error("Polling superseded by new operation."));
					return; // Stop this old poll
				}

				if (Date.now() - startTime > timeout) {
					clearInterval(intervalId);
					reject(new Error(`Polling timed out after ${timeout / 1000}s`));
					return;
				}

				try {
					const res = await fetch(statusUrl, {
						headers: {
							"Authorization": `Bearer ${apiKey}`,
						},
					});
					const data = await res.json();
					if (data && data.status) statusSetter(data.status);

					if (data && typeof data.status === 'string' && data.status.startsWith(completionPrefix)) {
						clearInterval(intervalId);
						// Resolve with the final status so the caller can use it
						resolve(data.status);
					}

					// --- NEW: Explicitly check for failure states ---
					if (data && typeof data.status === 'string' && (data.status.toLowerCase().includes("failed") || data.status.toLowerCase().includes("error"))) {
						clearInterval(intervalId);
						reject(new Error(data.status)); // Reject with the specific error message from the backend
					}
				} catch (e) {
					console.error("Polling check failed:", e);
					// Don't reject here, allow it to retry until timeout
				}
			};

			intervalId = setInterval(checkStatus, 2000); // Poll every 2 seconds
		});
	};

	// Helper function to introduce a delay
	const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

	const setAutomationStepCompleted = (stepId: string) => {
		setLastCompletedStep(stepId);
		localStorage.setItem(`geoShieldLastStep_${projectID}`, stepId);
	};


	// --- AUTOMATION ENGINE ---
	const runAutomationSequence = async (riskLevel: string) => {
		if (!projectID || isAutomationRunning) return;
		logToServer(`[LOG] AUTOMATION WORKFLOW: Starting for Risk Level: ${riskLevel}`);
		setRiskChangeAlert(null); // Clear the alert when automation starts
		setIsAutomationRunning(true);
		setLoading(true);
		abortControllerRef.current = new AbortController(); // New controller for automation
		setStatus(`Automation started for Risk Level ${riskLevel}`);
		let isPausedForReview = false;

		try {
			const stepsOrder = ["auth", "discover", "filter", "plan", "apply", "migrate"];
			const lastCompletedIndex = stepsOrder.indexOf(lastCompletedStep);

			// R0: Auth
			if (riskLevel >= "R0" && lastCompletedIndex < stepsOrder.indexOf("auth")) {
				setLoading(true);
				setStatus("Step 1: Authenticating...");
				await apiCall("auth", "POST");
				const authStatus = await pollStatus(
					`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/auth/status`,
					"Completed",
					45 * 1000,
					setStatus,
				);
				if (authStatus.includes("Failed")) {
					throw new Error("Authentication failed.");
				}
				setAutomationStepCompleted("auth");
				setViewMode("auth");
				setStatus("Auth complete. Waiting 7s before next step...");
				setLoading(false);
				await delay(7000);
			}

			if (riskLevel >= "R1" && lastCompletedIndex < stepsOrder.indexOf("discover")) {
				setLoading(true);
				setStatus("Step 2: Discovering resources...");
				await apiCall("discover", "POST");
				const discoveryStatus = await pollStatus(
					`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/discover/status`,
					"Discovery completed",
					5 * 60 * 1000, // 5 minute timeout for discovery
					setStatus,
				);
				if (discoveryStatus.includes("failed")) {
					throw new Error("Discovery failed.");
				}
				setAutomationStepCompleted("discover");
				await fetchResources();
				setViewMode("discovered");
				setStatus("Discovery complete. Waiting 20s before next step...");
				setLoading(false);
				await delay(20000); // This was already 20 seconds, updated status message for consistency
			}

			// R2: R1 actions + Filter -> Plan
			if (riskLevel >= "R2" && lastCompletedIndex < stepsOrder.indexOf("filter")) {
				setLoading(true);
				setStatus("Step 3: Filtering critical resources...");
				const initialFilterResponse = await apiCall("filter", "POST");

				let filterStatus = "";
				// If the initial call returns a status (e.g., from cache), use it. Otherwise, poll.
				if (initialFilterResponse?.status?.includes("Filter process completed")) {
					filterStatus = initialFilterResponse.status;
				} else {
					filterStatus = await pollStatus(
						`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/filter/status`,
						"Filter process completed", // More generic prefix to catch both cache and fresh runs
						5 * 60 * 1000,
						setStatus,
					);
				}

				if (filterStatus.includes("failed")) {
					throw new Error("Filtering failed.");
				}
				setAutomationStepCompleted("filter");
				await fetchActiveResources();
				setViewMode("active");

				// Always stop after the filter step to allow for user review and confirmation.
				setStatus("Please review the filtered resources, make selections, and confirm to proceed.");
				setLoading(false); // Stop the loader and wait for user confirmation.
				isPausedForReview = true;
				return; // The sequence will be continued by the 'Confirm Selection & View Plan' button.
			}

			// R3: R2 actions + Apply
			if (riskLevel >= "R3" && lastCompletedIndex < stepsOrder.indexOf("apply")) {
				setLoading(true);
				setStatus("Step 5: Applying Terraform plan...");
				await apiCall("apply", "POST", { resources: resourcesToPlan, workspaceId: workspaceId });
				const applyStatus = await pollStatus(
					`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/plan/status`, // Still polls plan status
					"APPLY_COMPLETED::",
					15 * 60 * 1000,
					setStatus,
				);
				if (applyStatus.includes("failed")) {
					throw new Error("Terraform apply failed.");
				}
				setAutomationStepCompleted("apply");
				const finalApplyOutput = applyStatus.substring("APPLY_COMPLETED::".length);
				setApplyOutput(finalApplyOutput);
				setViewMode("apply");
				setStatus("Terraform apply complete. Waiting 30s before next step...");
				setLoading(false);
				await delay(30000);
			}

			// R4: R3 actions + Migrate
			if (riskLevel >= "R4" && lastCompletedIndex < stepsOrder.indexOf("migrate")) {
				setLoading(true);
				setStatus("Step 6: Starting application migration...");
				await apiCall("migrate", "POST");
				const migrateStatus = await pollStatus(
					`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/migrate/status`,
					"Completed",
					2 * 60 * 60 * 1000,
					setMigrationStatus,
				);
				if (migrateStatus.includes("Failed")) {
					throw new Error("Migration failed.");
				}
				setAutomationStepCompleted("migrate");
				setStatus("Application migration complete.");
				setLoading(false);
			}
			setStatus(`Automation completed for Risk Level ${riskLevel}.`);
		} catch (error: any) {
			// If any step fails, ensure the loader is turned off.
			setIsAutomationRunning(false);
			setLoading(false);
			setStatus(`Automation failed: ${error.message}`);
		} finally {
			// Only reset the automation state if the process is not intentionally paused for user input.
			if (!isPausedForReview) {
				setIsAutomationRunning(false);
			}
			setLoading(false);
		}
	};

	const continueAutomation = async (riskLevel: string) => {
		if (!isAutomationRunning) return;
		logToServer(`[LOG] AUTOMATION WORKFLOW: Continuing automation for Risk Level: ${riskLevel}`);
		setLoading(true);
		try {
			// This function is called after the user confirms the selection in the 'active' view,
			// continuing the sequence from the 'plan' step onwards.
			const stepsOrder = ["auth", "discover", "filter", "plan", "apply", "migrate"];
			const lastCompletedIndex = stepsOrder.indexOf(lastCompletedStep);

			if (riskLevel >= "R2" && lastCompletedIndex < stepsOrder.indexOf("plan")) {
				setStatus("Step 4: Generating Terraform plan...");
				// The handleManualAction will now automatically chain to the 'apply' step if needed.
				await handleManualAction("plan", "POST", { resources: resourcesToPlan, workspaceId: "" }, true, "COMPLETED::", 15 * 60 * 1000); 
				setAutomationStepCompleted("plan");
			}

			// The rest of the automation (Apply, Migrate) is now handled by the chaining logic
			// inside handleManualAction. We check if the process is still running.
			if (isAutomationRunning) {
				// If we reach here, it means the sequence completed (e.g., R2 plan finished).
				// For R3+, the apply step will set isAutomationRunning to false.
				if (riskLevel < "R3") {
					setStatus(`Automation completed for Risk Level ${riskLevel}.`);
					setIsAutomationRunning(false);
				}
			}
		} catch (error) {
			// Errors are handled inside handleManualAction, which will update the status.
			setIsAutomationRunning(false);
			setLoading(false);
			setStatus(`Automation failed during continuation: ${error}`);
		}
	}

	// Generic handler for manual button clicks
	const handleManualAction = async (endpoint: string, method: string, bodyData?: any, poll: boolean = false, completionPrefix: string = "", timeout: number = 0, queryParams: string = "") => {
		logToServer(`[LOG] MANUAL WORKFLOW: Executing endpoint: ${endpoint}`);

		if (endpoint === 'plan') {
			logToServer(`[LOG] Frontend cache miss for plan. Requesting new plan from backend.`);
		}

		setLoading(true);
		abortControllerRef.current = new AbortController();
		
		let statusSetter: (status: string) => void = setStatus;
		if (endpoint === 'migrate') {
			setMigrationStatus(""); // Clear previous status
			statusSetter = (newStatus: string) => {
				setStatus(newStatus);
				setMigrationStatus(newStatus);
			};
		} else if (endpoint === 'cutover') {
			setCutoverStatus(""); // Clear previous status
			statusSetter = (newStatus: string) => {
				setStatus(newStatus);
				setCutoverStatus(newStatus);
			};
		}

		statusSetter(`Executing ${endpoint}...`);
		try {
			// Step 1: Make the initial API call
			await apiCall(endpoint, method, bodyData, abortControllerRef.current.signal, queryParams);

			// Step 2: Poll for completion if required
			let finalStatus = "";
			if (poll) {
				// All terraform operations (plan, apply, destroy) use the same status endpoint
				const statusEndpoint = (endpoint === 'plan' || endpoint === 'apply' || endpoint === 'destroy') 
					? 'plan' 
					: endpoint;

				const pollResult = await pollStatus(
					`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/${statusEndpoint}/status`,
					completionPrefix,
					timeout,
					statusSetter
				);
				finalStatus = pollResult; // Assign the result for further processing
			}

			// Step 3: Perform actions after completion
			if (endpoint === 'discover') {
				setStatus("Fetching discovered resources...");
				await fetchResources();
				setViewMode('discovered');
			} else if (endpoint === 'auth') {
				// When auth is complete, we stay on the auth view to show the status.
				setViewMode('auth');
			} else if (endpoint === 'filter') {
				setStatus("Fetching active resources...");
				await fetchActiveResources();
				setViewMode('active');
			} else if (endpoint === 'plan') {
				const parts = finalStatus.split("::");
				const newWorkspaceId = parts[1];
				const newPlanOutput = parts[2];

				setWorkspaceId(newWorkspaceId);
				setPlanOutput(newPlanOutput);
				setViewMode('plan');

				// If automation is running, continue to the next step (Apply)
				if (isAutomationRunning && latestRiskMessage?.currentRiskLevel && latestRiskMessage.currentRiskLevel >= "R3") {
					setStatus("Plan generated. Waiting 30s before applying...");
					setLoading(false); // Turn off loader to allow plan review
					await delay(30000); // Wait before applying
					// The 'apply' action will set its own loading state.
					await handleManualAction("apply", "POST", { resources: resourcesToPlan, workspaceId: newWorkspaceId }, true, "APPLY_COMPLETED::", 15 * 60 * 1000);
				}
			} else if (endpoint === 'apply') {
				const finalApplyOutput = finalStatus.substring(completionPrefix.length);
				setApplyOutput(finalApplyOutput);
				setViewMode('apply');

				// --- FRONTEND CACHE INVALIDATION ---
				// The plan has been applied, so the cache is no longer valid.
				localStorage.removeItem(`geoShieldPlanCache_${projectID}`);
				logToServer("[LOG] Cleared frontend plan cache after successful apply.");

				// If automation is running for R4, continue to the migrate step
				if (isAutomationRunning && latestRiskMessage?.currentRiskLevel && latestRiskMessage.currentRiskLevel >= "R4") {
					setStatus("Apply complete. Waiting 30s before migrating...");
					setLoading(false); // Turn off loader during the delay
					await delay(30000);
					await handleManualAction("migrate", "POST", undefined, true, "Completed", 2 * 60 * 60 * 1000);
				}
			}

		} catch (error: any) {
			// Error logging is handled in apiCall and pollStatus, this just catches to prevent crash
			// Only log errors that are not due to user cancellation.
			if (error.message !== "Operation cancelled by user.") {
				console.error(`Manual action ${endpoint} failed:`, error);
				statusSetter(`Error: ${error.message}`);
				// If a plan fails, show the detailed error in the plan view.
				if (endpoint === 'plan') {
					setPlanOutput(error.message);
					setViewMode('plan');
				}
			}
		} finally {
			// Only turn off loading if not in a chained automation step that handles its own loading.
			const isChainedPlan = isAutomationRunning && endpoint === 'plan' && latestRiskMessage?.currentRiskLevel && latestRiskMessage.currentRiskLevel >= "R3";
			if (!isChainedPlan) {
				setLoading(false);
			}

		}
	};

	const handleCancel = async () => {
		setStatus("Cancelling operation...");
		try {
			// Send a request to the backend to terminate the running process.
			await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/gcp/cancel`, {
				headers: {
					"Authorization": `Bearer ${apiKey}`,
				},
				method: 'POST',
			});
			// The backend will kill the process, and the polling on the frontend
			// will eventually fail or see a "cancelled" status.
		} catch (e) {
			console.error("Failed to send cancel request to backend", e);
		} finally {
			// Abort the frontend controller to stop any ongoing fetch/poll attempts immediately.
			abortControllerRef.current?.abort();
			setLoading(false);
			setIsAutomationRunning(false);
		}
	};

	useEffect(() => {
		const project = searchParams.get("project");
		if (project && !projectID) {
			setProjectID(project);
		}
		// We only want this to run once on load when a project is in the URL
	}, [searchParams]);

	// Debounce the resourcesToPlan state to avoid saving on every single click
	const debouncedResourcesToPlan = useDebounce(resourcesToPlan, 1000); // 1-second delay

	// Effect to automatically save user's selections to the backend
	useEffect(() => {
		// Don't save if the object is empty or if the API key isn't set
		if (Object.keys(debouncedResourcesToPlan).length === 0 || !apiKey) {
			return;
		}

		console.log("Debounced change detected, saving resource selections to backend...");
		apiCall("resources/active/save", "POST", { resources: debouncedResourcesToPlan });
	}, [debouncedResourcesToPlan, apiKey]);

	useEffect(() => {
		if (webSocketLatestMessage) {
			const attrs = webSocketLatestMessage.attributes;
			const body = JSON.parse(webSocketLatestMessage.data);
			const regionKey = body.id;

			// On first message, stop the loading indicator.
			if (isLatestRiskLoading) {
				setIsLatestRiskLoading(false);
			}

			if (regionKey && attrs.current_risk_level) {
				setLatestRiskMessage(prev => {
					// --- NEW RISK MANAGEMENT LOGIC ---
					// 1. Never downgrade the risk level.
					// 2. Only update if the new risk is higher than the previous highest.
					const newRisk = attrs.current_risk_level;
					const currentRisk = prev?.currentRiskLevel || "R0";

					// Extract numbers from risk levels (e.g., "R3" -> 3)
					const newRiskNum = parseInt(newRisk.replace("R", ""), 10);
					const currentRiskNum = parseInt(currentRisk.replace("R", ""), 10);

					// If the new risk is not higher, do not update the state.
					if (newRiskNum <= currentRiskNum) {
						return prev;
					}
					setRiskChangeAlert(`Risk level has been upgraded to ${newRisk}. Please take Action.`);

					// Otherwise, update with the new (or first) message.
					return {
						regionName: body.region_name,
						cloudProvider: body.cloud_provider,
						id: body.id,
						previousRiskLevel: attrs.previous_risk_level || "N/A",
						currentRiskLevel: attrs.current_risk_level,
						time: body.time,
					};
				});
				setRiskLevels(prev => ({
					...prev,
					[regionKey]: {
						current: attrs.current_risk_level,
						previous: attrs.previous_risk_level || "N/A",
					},
				}));
			}
		}
	}, [webSocketLatestMessage]);

	// Effect to check if a cached plan exists for the current selection
	useEffect(() => {
		if (Object.keys(resourcesToPlan).length > 0) {
			const cachedPlanData = localStorage.getItem(`geoShieldPlanCache_${projectID}`);
			if (cachedPlanData) {
				try {
					const parsedCache = JSON.parse(cachedPlanData);
					const currentPlanKey = getCanonicalJson(resourcesToPlan);
					if (parsedCache.cacheKey === currentPlanKey) {
						setHasCachedPlan(true);
						return;
					}
				} catch (e) { /* ignore parsing errors */ }
			}
		}
		setHasCachedPlan(false);
	}, [resourcesToPlan, projectID]);


	const steps = [
		{ id: "auth", label: "Auth", color: "bg-orange-500" },
		{ id: "discovered", label: "Discover", color: "bg-blue-500" },
		{ id: "active", label: "Filter", color: "bg-emerald-500" },
		{ id: "plan", label: "Plan", color: "bg-purple-500" },
		{ id: "apply", label: "Apply", color: "bg-red-500" },
		{ id: "migrate", label: "Migrate", color: "bg-teal-500" },
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
						onClick={handleCancel}
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
					<div className="w-full md:flex-1 md:max-w-lg flex flex-col md:flex-row gap-4 items-end">
						<div className="w-full">
							<label htmlFor="projectID" className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Project ID</label>
							<input
								id="projectID"
								type="text"
								value={projectID}
								onChange={(e) => setProjectID(e.target.value)}
								placeholder="Enter your Project ID..."
								className="w-full mt-1 bg-white border-2 border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono text-blue-700"
							/>
						</div>
						<div className="w-full">
							<label htmlFor="apiKey" className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">API Key</label>
							<input
								id="apiKey"
								type="password"
								value={apiKey}
								onChange={(e) => handleApiKeyChange(e.target.value)}
								placeholder="Enter your API Key..."
								className="w-full mt-1 bg-white border-2 border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono text-blue-700"
							/>
						</div>
						<button
							onClick={() => {
								if (ws && ws.readyState === WebSocket.OPEN) {
									disconnect();
									setWorkflowMode('manual'); // Revert to manual mode on disconnect
								} else {
									if (apiKey) { // Ensure apiKey is loaded before connecting
										connect(projectID, apiKey);
										setWorkflowMode('auto'); // Set default to auto-workflow on connect
									}
								}
							}}
							disabled={!projectID || !apiKey}
							className={`px-4 py-3 rounded-xl font-bold text-white transition-all flex-shrink-0 flex items-center gap-2 ${ws ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700"} disabled:opacity-50`}
						>
							<span className={`w-2 h-2 rounded-full ${ws ? "bg-green-400 animate-pulse" : "bg-slate-400"}`} />
							{ws ? "Disconnect" : "Connect"}
						</button>
					</div>
				</header>

				<section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
					<div className="flex items-center justify-center md:justify-end gap-4">
						<h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider hidden md:block">Workflow Mode</h3>
						<div className="flex items-center justify-center gap-3 p-2 rounded-full bg-slate-50 border border-slate-100">
							<span className={`text-sm font-bold ${workflowMode === 'manual' ? 'text-slate-700' : 'text-slate-400'}`}>Manual</span>
							<button
								onClick={() => setWorkflowMode(prev => prev === 'manual' ? 'auto' : 'manual')}
								disabled={isAutomationRunning}
								className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${workflowMode === 'auto' ? 'bg-red-600' : 'bg-slate-300'}`}
								role="switch"
								aria-checked={workflowMode === 'auto'}
							>
								<span
									aria-hidden="true"
									className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${workflowMode === 'auto' ? 'translate-x-5' : 'translate-x-0'}`}
								/>
							</button>
							<span className={`text-sm font-bold ${workflowMode === 'auto' ? 'text-red-600' : 'text-slate-400'}`}>Auto-Workflow</span>
						</div>
					</div>
				</section>

				{(latestRiskMessage) && (
					<section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in duration-300">
						<h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
							<span className="w-1.5 h-6 bg-red-500 rounded-full" />
							Latest Global Risk Update
						</h2>
						{riskChangeAlert && (
							<div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-lg flex items-center gap-3">
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
								{riskChangeAlert}
							</div>
						)}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
							<div>
								<p className="text-slate-500">Region:</p>
								{isLatestRiskLoading ? <div className="h-5 w-3/4 bg-slate-200 rounded animate-pulse" /> :
									<p className="font-bold text-slate-700">
										{latestRiskMessage?.regionName} ({latestRiskMessage?.id})
									</p>
								}
							</div>
							<div>
								<p className="text-slate-500">Cloud Provider:</p>
								{isLatestRiskLoading ? <div className="h-5 w-1/4 bg-slate-200 rounded animate-pulse" /> :
									<p className="font-bold text-slate-700">{latestRiskMessage?.cloudProvider}</p>
								}
							</div>
							<div>
								<p className="text-slate-500">Previous Risk Level:</p>
								{isLatestRiskLoading ? <div className="h-5 w-1/4 bg-slate-200 rounded animate-pulse" /> :
									<p className={`font-bold ${getRiskColorClass(latestRiskMessage?.previousRiskLevel || "")}`}>{latestRiskMessage?.previousRiskLevel}</p>
								}
							</div>
							<div>
								<p className="text-slate-500">Current Risk Level:</p>
								{isLatestRiskLoading ? <div className="h-7 w-1/4 bg-slate-200 rounded animate-pulse" /> :
									<p className={`font-bold text-xl ${getRiskColorClass(latestRiskMessage?.currentRiskLevel || "")}`}>{latestRiskMessage?.currentRiskLevel}</p>
								}
							</div>
							<div className="md:col-span-2">
								<p className="text-slate-500">Last Updated:</p>
								{isLatestRiskLoading ? <div className="h-5 w-1/2 bg-slate-200 rounded animate-pulse" /> :
									<p className="font-mono text-slate-700">
										{hasMounted ? new Date(latestRiskMessage?.time || "").toLocaleTimeString() : "..."}
									</p>
								}
							</div>
							<div className="md:col-span-2 flex items-center justify-end">
								<button
									onClick={() => runAutomationSequence(latestRiskMessage?.currentRiskLevel || "")}
									disabled={isAutomationRunning || isLatestRiskLoading || !latestRiskMessage || workflowMode === 'manual'}
									className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-red-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
									Run Automation for {latestRiskMessage?.currentRiskLevel}
								</button>
							</div>
						</div>
					</section>
				)}

				<section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-6">
					<div className="flex flex-col md:flex-row items-center justify-between gap-4">
						<div className="flex flex-1 items-center gap-3 bg-slate-50 text-slate-600 px-5 py-3 rounded-xl shadow-sm border border-slate-100 min-w-0">
							<svg
								className={`w-5 h-5 ${loading || isAutomationRunning ? "animate-spin" : ""}`}
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
							<span
								className="text-sm font-bold tracking-wide truncate"
								title={status}
							>
								{isAutomationRunning ? `AUTO: ${status}` : status || "Ready"}
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

					{workflowMode === 'manual' && (<div className="grid grid-cols-2 lg:grid-cols-5 gap-4 animate-in fade-in duration-300">
						<button
							onClick={() => handleManualAction("auth", "POST", undefined, true, "Completed", 45 * 1000)}
							disabled={loading || isAutomationRunning}
							className="group relative overflow-hidden bg-orange-500 hover:bg-orange-600 text-white px-6 py-4 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-orange-200 active:scale-95 disabled:opacity-50"
						>
							<span className="relative z-10 flex items-center justify-center gap-2">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
								</svg>
								AUTH
							</span>
						</button>
						<button
							onClick={() => handleManualAction("discover", "POST", undefined, true, "Discovery completed", 5 * 60 * 1000)}
							disabled={loading || isAutomationRunning}
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
							onClick={() => handleManualAction("filter", "POST", undefined, true, "Filter process completed", 5 * 60 * 1000)}
							disabled={loading || isAutomationRunning}
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
							onClick={() => handleManualAction("plan", "POST", { resources: resourcesToPlan, workspaceId: "" }, true, "COMPLETED::", 15 * 60 * 1000)}
							disabled={loading || isAutomationRunning || Object.keys(resourcesToPlan).length === 0}
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
							onClick={() => setViewMode('migrate')}
							disabled={loading || isAutomationRunning}
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
							className="h-full"
						>
							<button
								disabled={loading || !projectID || isAutomationRunning}
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
							className="h-full"
						>
							<button
								disabled={loading || !projectID || isAutomationRunning}
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
					</div>)}
				</section>

				<section className="pt-4">
					{/* DISCOVERED VIEW */}
					{viewMode === "discovered" && (
						<div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
							<div className="px-2 flex items-center justify-between">
								<h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
									<span className="w-1.5 h-6 bg-blue-500 rounded-full" />
									Discovery Results
								</h2>
								{discoveryMetadata && (
									<p className="text-xs text-slate-400 font-medium">
										Last updated by <span className="font-bold text-slate-500">{discoveryMetadata.user_id}</span> on {new Date(discoveryMetadata.last_run_at).toLocaleString()}
									</p>
								)}
								<button
									onClick={() => handleManualAction("discover", "POST", undefined, true, "Discovery completed", 5 * 60 * 1000, "&force_refresh=true")}
									disabled={loading || isAutomationRunning}
									className="group relative overflow-hidden bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg font-bold transition-all hover:shadow-lg hover:shadow-sky-200 active:scale-95 disabled:opacity-50 text-xs"
									title="Force a new discovery run, ignoring any cached data."
								>
									<span className="relative z-10 flex items-center justify-center gap-2">
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5m-5-2h14a2 2 0 012 2v4a2 2 0 01-2 2H9m-5-4v5h5m-5-2h14a2 2 0 002-2V7a2 2 0 00-2-2H5" />
										</svg>
										Force Refresh
									</span>
								</button>
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
															<th className="px-6 py-4 font-bold uppercase tracking-wider text-red-500">Risk</th>
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
																	{(() => {
																		const region = row[rows[0]?.indexOf("Region")];
																		const risk = riskLevels[region];
																		if (risk) {
																			return <span className={`font-bold ${getRiskColorClass(risk.current)}`}>{risk.current}</span>;
																		}
																		return <span className="text-slate-400">-</span>;
																	})()}
																</td>
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
								<div className="flex items-center gap-2 pt-1">
									<button
										onClick={async () => {
											// A true force refresh must first re-discover, then re-filter.
											await handleManualAction("discover", "POST", undefined, true, "Discovery completed", 5 * 60 * 1000, "&force_refresh=true");
											await handleManualAction("filter", "POST", undefined, true, "Filter process completed", 5 * 60 * 1000, "&force_refresh=true");
										}}
										disabled={loading || (isAutomationRunning && !status.includes("Please review"))}
										className="group relative overflow-hidden bg-sky-600 hover:bg-sky-700 text-white px-6 py-2 rounded-lg font-bold transition-all hover:shadow-lg hover:shadow-sky-200 active:scale-95 disabled:opacity-50 text-xs whitespace-nowrap"
										title="Force a new filter run, ignoring any cached data."
									>
										<span className="relative z-10 flex items-center justify-center gap-2">
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5m-5-2h14a2 2 0 012 2v4a2 2 0 01-2 2H9m-5-4v5h5m-5-2h14a2 2 0 002-2V7a2 2 0 00-2-2H5" />
											</svg>
											Force Refresh
										</span>
									</button>
									<button
										onClick={async () => {
											setLoading(true);
											try {
												setStatus("Clearing plan cache...");
												await apiCall("plan/cache/clear", "POST");
												localStorage.removeItem(`geoShieldPlanCache_${projectID}`);
												setPlanOutput("");
												setWorkspaceId("");
												setStatus("Plan cache cleared successfully.");
											} finally {
												setLoading(false);
											}
										}}
										disabled={loading || (isAutomationRunning && !status.includes("Please review"))}
										className="group relative overflow-hidden bg-amber-500 hover:bg-amber-600 text-white px-8 py-2 rounded-lg font-bold transition-all hover:shadow-lg hover:shadow-amber-200 active:scale-95 disabled:opacity-50 text-xs whitespace-nowrap"
										title="Clear any cached Terraform plans for this project, forcing a new plan to be generated on the next run."
									>
										Clear Plan Cache
									</button>
								</div>
								<div className="w-full flex flex-col md:flex-row md:items-end gap-4 border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0 md:pl-6">
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
										<div className="flex items-center gap-2">
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
									<div className="flex-shrink-0">
										<button
											onClick={applyBulkUpdate}
											disabled={!bulkRegion && !bulkSubnet}
											className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
										>
											Apply to All 
										</button>
									</div>
								</div>
							</div>
							{/* --- AUTOMATION CONFIRMATION ROW --- */}
							{isAutomationRunning && (
								<div className="mt-6 w-full bg-purple-50 border-2 border-dashed border-purple-200 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-center md:justify-between gap-4 text-center md:text-left">
									<div className="flex-grow">
										<div className="flex items-center justify-center md:justify-start gap-3 text-purple-800 text-sm font-semibold">
											<svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
											<span>Please review and confirm the selected resources to continue the automated workflow.</span>
										</div>
										{filterMetadata && (
											<p className="text-xs text-purple-500 font-medium mt-1 ml-8">
												(Resource list is from a cache generated at {new Date(filterMetadata.last_filtered_at).toLocaleString()} by <span className="font-bold">{filterMetadata.user_id}</span>)
											</p>
										)}
									</div>
									<button
										onClick={() => continueAutomation(latestRiskMessage?.currentRiskLevel || "")}
										disabled={loading || Object.keys(resourcesToPlan).length === 0}
										className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all hover:shadow-lg hover:shadow-purple-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm flex-shrink-0"
									>
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										Confirm & Continue
									</button>
								</div>
							)}

							{hasCachedPlan && (
								<div className="mt-4 w-full bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-center gap-3 text-blue-800 text-sm font-semibold">
									<svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
									</svg>
									<span>A cached plan already exists for this selection. Clicking "View Plan" will be instantaneous.</span>
								</div>
							)}

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
											<div className="flex items-center gap-4">
												<input
													type="checkbox"
													className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
													checked={
														// Checked if all resources in this service are selected
														(resourcesToPlan[service]?.length || 0) - 1 === rows.length - 1 && rows.length > 1
													}
													onChange={(e) => {
														e.stopPropagation(); // Prevent the section from toggling
														setResourcesToPlan((prev) => {
															const updated = { ...prev };
															if (e.target.checked) {
																// Select all resources for this service
																updated[service] = rows;
															} else {
																// Deselect all for this service
																delete updated[service];
															}
															return updated;
														});
													}}
												/>
												<h3 className="text-xs font-black text-emerald-700 uppercase tracking-widest">
													{service}
												</h3>
											</div>
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
															<th className="px-4 py-4"></th>
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
																<td className="px-6 py-4">
																	<input
																		type="checkbox"
																		className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
																		checked={
																			resourcesToPlan[service]?.some(
																				(r) => r[0] === row[0]
																			) ?? false
																		}
																		onChange={(e) => {
																			setResourcesToPlan((prev) => {
																				const updated = { ...prev };
																				if (e.target.checked) {
																					if (!updated[service]) {
																						updated[service] = [rows[0]]; // Add header
																					}
																					updated[service] = [...updated[service], row];
																				} else {
																					updated[service] = updated[service].filter((r) => r[0] !== row[0]);
																					if (updated[service].length <= 1) delete updated[service];
																				}
																				return updated;
																			});
																		}}
																	/>
																</td>

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
										onClick={() => handleManualAction("apply", "POST", { resources: resourcesToPlan, workspaceId: workspaceId }, true, "APPLY_COMPLETED::", 15 * 60 * 1000)}
										disabled={loading || (isAutomationRunning && latestRiskMessage?.currentRiskLevel === 'R2')}
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

					{/* AUTH VIEW */}
					{viewMode === 'auth' && (
						<div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in duration-300">
							<div className="flex flex-col md:flex-row items-center gap-6">
								<div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center text-orange-400 flex-shrink-0">
									<svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
									</svg>
								</div>
								<div className="text-center md:text-left">
									<h3 className="text-lg font-bold text-slate-800">
										Authentication Status
									</h3>
									<dl className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-sm text-slate-600">
										<div className="flex justify-center md:justify-start gap-2">
											<dt className="font-semibold text-slate-500">User:</dt>
											<dd className="font-mono text-orange-700">{apiKey.split('-')[0] || 'Unknown'}</dd>
										</div>
										<div className="flex justify-center md:justify-start gap-2">
											<dt className="font-semibold text-slate-500">Status:</dt>
											<dd className="font-semibold text-orange-600">{status}</dd>
										</div>
										<div className="flex justify-center md:justify-start gap-2">
											<dt className="font-semibold text-slate-500">Time:</dt>
											<dd className="font-mono">{new Date().toLocaleString()}</dd>
										</div>
									</dl>
								</div>
							</div>
						</div>
					)}

					{/* MIGRATE VIEW */}
					{viewMode === 'migrate' && (
						<div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-in fade-in duration-300">
							<div className="flex flex-col items-center gap-6">
								<div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center text-teal-400 flex-shrink-0">
									<svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
									</svg>
								</div>
								<div className="text-center">
									<h3 className="text-lg font-bold text-slate-800">
										Application Migration & Cutover
									</h3>
									<p className="mt-1 text-sm text-slate-500 max-w-2xl">
										This process will initiate the data synchronization and application cutover to the new virtual machine. This is the final step in the migration process. Please ensure all previous steps have been completed successfully.
									</p>
								</div>

								<div className="w-full space-y-4">
									{/* Data Migration Section */}
									<div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
										<div className="flex items-center justify-between">
											<div>
												<h4 className="font-bold text-slate-700">1. Data Migration</h4>
												<p className="text-xs text-slate-500">Back up and restore the database to the new environment.</p>
											</div>
											<button
												onClick={() => handleManualAction("migrate", "POST", undefined, true, "Completed", 2 * 60 * 60 * 1000)}
												disabled={loading || isAutomationRunning}
												className="group relative overflow-hidden bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-bold transition-all text-sm"
											>
												Start Data Migration
											</button>
										</div>
										{migrationStatus && <p className="text-xs text-slate-500 mt-2">Status: <span className="font-semibold text-teal-700">{migrationStatus}</span></p>}
									</div>

									{/* Cutover Section */}
									<div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
										<div className="flex items-center justify-between">
											<div>
												<h4 className="font-bold text-slate-700">2. Final Cutover</h4>
												<p className="text-xs text-slate-500">Point the load balancer to the new virtual machine endpoint.</p>
											</div>
											<button
												onClick={() => handleManualAction("cutover", "POST", undefined, true, "Completed", 10 * 60 * 1000)}
												disabled={loading || isAutomationRunning}
												className="group relative overflow-hidden bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold transition-all text-sm"
											>
												Start Cutover
											</button>
										</div>
										{cutoverStatus && <p className="text-xs text-slate-500 mt-2">Status: <span className="font-semibold text-indigo-700">{cutoverStatus}</span></p>}
									</div>
								</div>

								<button
									onClick={() => setViewMode('none')}
									className="text-sm font-bold text-slate-500 hover:text-slate-700 mt-4"
								>
									Back
								</button>
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

function HomePageLoading() {
	return (
		<main className="min-h-screen bg-gray-50 text-slate-900 p-4 md:p-8 font-sans">
			<div className="max-w-7xl mx-auto space-y-8">
				<header className="flex flex-col md:flex-row items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<svg className="w-10 h-10 text-blue-600" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M2 7L12 12L22 7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M12 22V12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
						<div>
							<h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">
								GeoShield
							</h1>
							<p className="text-sm text-slate-500 font-medium whitespace-nowrap">
								Cloud Landing Zone Provisioner
							</p>
						</div>
					</div>
					<div className="w-full md:flex-1 md:max-w-md h-12 bg-slate-200 rounded-xl animate-pulse" />
				</header>
				<div className="bg-white p-20 rounded-2xl border-2 border-dashed border-blue-100 flex flex-col items-center justify-center text-center space-y-4 animate-pulse">
					<h3 className="text-lg font-bold text-slate-700">Loading Project Details...</h3>
					<p className="text-sm text-slate-500 max-w-md">Please wait while we set up the control plane.</p>
				</div>
			</div>
		</main>
	);
}