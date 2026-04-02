"use client";

import { useState, useEffect, useRef, FormEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useWebSocket } from "@/contexts/WebSocketContext";

export default function StreamingPageWrapper() {
	return (
		// Wrap the component that uses useSearchParams in a Suspense boundary
		<Suspense fallback={<StreamingPageLoading />}>
			<StreamingPage />
		</Suspense>
	);
}

function StreamingPage() {
	const searchParams = useSearchParams();
	const [projectID, setProjectID] = useState<string>("");
	const [streamingProjectID, setStreamingProjectID] = useState<string>(""); // For the actual streaming project
	const [streamingTopicName, setStreamingTopicName] = useState<string>("");
	const [messages, setMessages] = useState<Array<{ text: string; receivedTime: string; publishTime: string; messageId: string }>>([]);
	const [newMessage, setNewMessage] = useState("");
	const { ws, connect, disconnect, latestMessage } = useWebSocket();
	const [status, setStatus] = useState("Connecting to stream...");
	const [error, setError] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const project = searchParams.get("project");
		if (project) {
			setProjectID(project);
		} else {
			setError("No Project ID provided in the URL.");
		}
	}, [searchParams]);

	useEffect(() => {
		const apiKey = sessionStorage.getItem("geoShieldApiKey");
		if (projectID && apiKey) {
			connect(projectID, apiKey);
		}
	}, [projectID, connect]);

	useEffect(() => {
		if (latestMessage) {
			const parsedData = latestMessage;
			let displayText = parsedData.data;
			const attrs = parsedData.attributes;

			if (attrs && attrs.region_id && attrs.current_risk_level) {
				const body = JSON.parse(parsedData.data);
				const regionName = body.region_name || attrs.region_id;
				const cloudProvider = attrs.cloud_provider || body.cloud_provider;

				displayText = `Risk level for '${regionName}' (${cloudProvider}) changed from ${attrs.previous_risk_level || "N/A"} to ${attrs.current_risk_level}.`;
			} else {
				const body = JSON.parse(parsedData.data);
				displayText = `Risk level for '${body.region_name}' (${body.cloud_provider}/${body.id}) changed from ${body.previous_risk_level} to ${body.current_risk_level}.`;
			}

			const newMsg = {
				text: displayText,
				receivedTime: new Date().toLocaleTimeString(),
				publishTime: parsedData.publishTime,
				messageId: parsedData.messageId.substring(0, 8),
			};

			setMessages((prevMessages) => {
				const updated = [...prevMessages, newMsg];
				updated.sort((a, b) => new Date(a.publishTime).getTime() - new Date(b.publishTime).getTime());
				return updated;
			});
		}
	}, [latestMessage]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleSendMessage = (e: FormEvent) => {
		e.preventDefault();
		if (newMessage.trim() && ws && ws.readyState === WebSocket.OPEN) {
			ws.send(newMessage);
			setNewMessage("");
		}
	};

	return (
		<main className="min-h-screen bg-slate-900 text-slate-300 p-4 md:p-8 font-sans">
			<div className="max-w-6xl mx-auto space-y-6">
				<header className="flex items-center justify-between gap-4 bg-slate-800/50 p-6 rounded-2xl shadow-sm border border-slate-700">
					<div>
						<h1 className="text-2xl font-extrabold text-slate-100 tracking-tight">
							Pub/Sub Message Stream
						</h1>
						<p className="text-sm text-slate-400 font-medium">
							Real-time messages from topic <code className="font-mono text-blue-400">{streamingTopicName || "..."}</code> in project{" "}
							<code className="font-mono text-blue-400">{streamingProjectID || "loading..."}</code>
						</p>
					</div>
					<Link
						href={`/?project=${projectID}`}
						className="text-sm font-bold text-blue-400 hover:underline"
					>
						&larr; Back to Main Control Plane
					</Link>
				</header>

				<div className="bg-slate-800/50 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden">
					<div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex gap-1.5">
								<div className="w-3 h-3 rounded-full bg-red-500" />
								<div className="w-3 h-3 rounded-full bg-yellow-500" />
								<div className="w-3 h-3 rounded-full bg-green-500" />
							</div>
							<span className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">
								Live Stream
							</span>
						</div>
						<div className="flex items-center gap-2 text-xs font-bold text-slate-400">
							Status: {status}
						</div>
					</div>
					<div className="p-8 overflow-y-auto h-[55vh] custom-scrollbar bg-black/20">
						{error && <div className="text-red-400 p-4 font-mono">{error}</div>}
						<ul className="space-y-2">
							{messages.map((msg, index) => (
								<li key={index} className="font-mono text-xs text-green-300 animate-in fade-in">
									<span className="text-slate-500 mr-4">{`[${new Date(msg.publishTime).toLocaleString()}]`}</span>
									{msg.text} <span className="text-slate-600 ml-2 text-[10px]">{`[ID: ${msg.messageId}]`}</span>
								</li>
							))}
						</ul>
						<div ref={messagesEndRef} />
						{messages.length === 0 && !error && (
							<div className="text-slate-500 text-center py-10">
								Waiting for the first message to arrive...
							</div>
						)}
					</div>
				</div>

				<form onSubmit={handleSendMessage} className="bg-slate-800/50 p-4 rounded-2xl shadow-sm border border-slate-700 flex gap-4">
					<input
						type="text"
						value={newMessage}
						onChange={(e) => setNewMessage(e.target.value)}
						placeholder="Type a message to publish to the topic..."
						className="flex-grow bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-mono"
						disabled={status !== "Connected. Waiting for messages..."}
					/>
					<button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50" disabled={status !== "Connected. Waiting for messages..."}>
						Send
					</button>
				</form>

			</div>
		</main>
	);
}

function StreamingPageLoading() {
	return (
		<main className="min-h-screen bg-slate-900 text-slate-300 p-4 md:p-8 font-sans">
			<div className="max-w-6xl mx-auto space-y-6">
				<header className="flex items-center justify-between gap-4 bg-slate-800/50 p-6 rounded-2xl shadow-sm border border-slate-700">
					<div>
						<h1 className="text-2xl font-extrabold text-slate-100 tracking-tight">
							Pub/Sub Message Stream
						</h1>
						<p className="text-sm text-slate-400 font-medium">
							Loading stream details...
						</p>
					</div>
					<a
						href={`/`}
						className="text-sm font-bold text-blue-400 hover:underline"
					>
						&larr; Back to Main Control Plane
					</a>
				</header>

				<div className="bg-slate-800/50 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden">
					<div className="bg-slate-800 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex gap-1.5">
								<div className="w-3 h-3 rounded-full bg-red-500" />
								<div className="w-3 h-3 rounded-full bg-yellow-500" />
								<div className="w-3 h-3 rounded-full bg-green-500" />
							</div>
							<span className="text-xs font-black text-gray-400 uppercase tracking-widest ml-4">
								Live Stream
							</span>
						</div>
						<div className="flex items-center gap-2 text-xs font-bold text-slate-400">
							Status: Connecting...
						</div>
					</div>
					<div className="p-8 overflow-y-auto h-[55vh] custom-scrollbar bg-black/20 animate-pulse">
						<div className="text-slate-500 text-center py-10">Initializing connection...</div>
					</div>
				</div>
			</div>
		</main>
	);
}