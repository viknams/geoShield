"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function StreamingPage() {
	const searchParams = useSearchParams();
	const [projectID, setProjectID] = useState<string>("");
	const [messages, setMessages] = useState<Array<{ text: string; receivedTime: string; publishTime: string; messageId: string }>>([]);
	const [newMessage, setNewMessage] = useState("");
	const ws = useRef<WebSocket | null>(null);
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
		if (!projectID) return;

		// Construct WebSocket URL (ws:// or wss://)
		const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
		const wsUrl = apiUrl.replace(/^http/, "ws") + `/api/gcp/stream-pubsub-ws?project=${projectID}`;

		const socket = new WebSocket(wsUrl);
		ws.current = socket;

		socket.onopen = () => {
			setStatus("Connected. Waiting for messages...");
			setError("");
		};

		socket.onmessage = (event) => {
			let parsedData;
			try {
				parsedData = JSON.parse(event.data as string);
			} catch (e) {
				console.error("Failed to parse WebSocket message:", e, event.data);
				// If it's not JSON, it might be an error message from our backend
				if (typeof event.data === "string" && event.data.startsWith("Error:")) {
					setError(event.data);
					setStatus("Connection failed.");
					socket.close();
				}
				return;
			}

			if (parsedData.error) { // Handle structured errors from backend
				setError(parsedData.error);
				setStatus("Connection failed.");
				socket.close();
				return;
			}

			const newMsg = {
				text: parsedData.data,
				receivedTime: new Date().toLocaleTimeString(), // Time received by frontend
				publishTime: parsedData.publishTime, // Original publish time from Pub/Sub
				messageId: parsedData.messageId,
			};

			setMessages((prevMessages) => {
				const updated = [...prevMessages, newMsg];
				// Sort messages by their Pub/Sub publish time
				updated.sort((a, b) => new Date(a.publishTime).getTime() - new Date(b.publishTime).getTime());
				return updated;
			});
		};

		socket.onerror = (err) => {
			console.error("WebSocket error:", err);
			setStatus("Connection failed. Please check the backend and project ID.");
			setError(
				"Could not connect to the message stream. The topic might not exist or there could be a permissions issue.",
			);
		};

		socket.onclose = () => {
			setStatus("Disconnected.");
		};

		return () => {
			socket.close();
		};
	}, [projectID]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleSendMessage = (e: FormEvent) => {
		e.preventDefault();
		if (newMessage.trim() && ws.current && ws.current.readyState === WebSocket.OPEN) {
			ws.current.send(newMessage);
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
							Real-time messages from topic `geo-streaming-tp` in project{" "}
							<span className="font-mono text-blue-400">{projectID}</span>
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