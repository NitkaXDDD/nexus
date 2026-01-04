// client/src/App.js
import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Settings, X, Camera, Edit2, Volume2, VolumeX, Type, Zap, Paperclip, 
  Mic, MicOff, Square, Video as VideoIcon, VideoOff, Phone, PhoneOff, Smile, Send,
  Play, Pause 
} from "lucide-react";
import "./App.css";

const SERVER_URL = "http://localhost:3001";
const socket = io.connect(SERVER_URL);

const DEFAULT_SETTINGS = { theme: 'default', fontSize: 'medium', sound: true, animations: true };

const ICE_SERVERS = { 
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, 
    { urls: 'stun:global.stun.twilio.com:3478' }
  ] 
};

const AVAILABLE_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];

function App() {
  const [myProfile, setMyProfile] = useState({ username: "", avatar: null, bio: "" });
  const [tempUsername, setTempUsername] = useState(""); 
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef(null);

  // --- CALL STATE ---
  const [stream, setStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [callIncoming, setCallIncoming] = useState(null); 
  const [isCalling, setIsCalling] = useState(false);
  const [currentCallType, setCurrentCallType] = useState('video'); 
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();

  // --- CHAT STATE ---
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('nexus_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const [allUsers, setAllUsers] = useState([]);
  const [knownUsersCache, setKnownUsersCache] = useState({});
  const [searchQuery, setSearchQuery] = useState(""); 
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null); 
  const [myContacts, setMyContacts] = useState([]); 
  const [chats, setChats] = useState({}); 
  const [currentMessage, setCurrentMessage] = useState("");
  const [profileModalData, setProfileModalData] = useState(null); 
  const messagesEndRef = useRef(null);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState(null);

  // --- CUSTOM VOICE PLAYER ---
  const VoiceMessage = ({ src }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const audioRef = useRef(null);

    const togglePlay = (e) => {
      e.stopPropagation();
      const audio = audioRef.current; 
      if (!audio) return; 
      if (isPlaying) audio.pause(); 
      else audio.play(); 
      setIsPlaying(!isPlaying); 
    };

    const handleTimeUpdate = () => { 
      const audio = audioRef.current; 
      if (audio) { 
        const percent = (audio.currentTime / audio.duration) * 100; 
        setProgress(percent); 
      } 
    };

    const handleLoadedMetadata = () => { if(audioRef.current) setDuration(audioRef.current.duration); }
    const handleEnded = () => { setIsPlaying(false); setProgress(0); };
    
    const formatTime = (time) => { 
      if(isNaN(time)) return "0:00"; 
      const min = Math.floor(time / 60); 
      const sec = Math.floor(time % 60); 
      return `${min}:${sec < 10 ? '0'+sec : sec}`; 
    }

    return (
      <div className="voice-msg-player">
        <audio ref={audioRef} src={src} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleEnded} />
        <button className="voice-play-btn" onClick={togglePlay}>
          {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{marginLeft: 2}} />}
        </button>
        <div className="voice-track">
          <div className="voice-progress" style={{width: `${progress}%`}} />
        </div>
        <div className="voice-time">{formatTime(duration)}</div>
      </div>
    );
  };

  useEffect(() => {
    localStorage.setItem('nexus_settings', JSON.stringify(settings));
    document.body.setAttribute('data-theme', settings.theme);
    const sizes = { small: '13px', medium: '15px', large: '18px' };
    document.documentElement.style.setProperty('--font-size', sizes[settings.fontSize]);
  }, [settings]);

  // --- STREAMS ---
  useEffect(() => {
    if (myVideo.current && stream) myVideo.current.srcObject = stream;
  }, [stream, isCalling, callAccepted]);

  useEffect(() => {
    if (userVideo.current && remoteStream) {
      userVideo.current.srcObject = remoteStream;
      userVideo.current.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    }
  }, [remoteStream, callAccepted]);

  const forceUnmute = () => {
    if (userVideo.current) {
      userVideo.current.play();
      userVideo.current.muted = false;
      setAudioBlocked(false);
    }
  };

  const playSound = (type = 'msg') => {
    if (settings.sound) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if(type === 'call') { osc.frequency.value = 440; gain.gain.value = 0.1; osc.start(); osc.stop(ctx.currentTime + 1); } 
      else { osc.frequency.value = 600; gain.gain.value = 0.05; osc.start(); osc.stop(ctx.currentTime + 0.1); }
    }
  };

  // --- WEBRTC ---
  const getMediaConstraints = (type) => ({
    video: type === 'video',
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });

  const callUser = async (type) => {
    if (!selectedUser) return;
    setIsCalling(true); setCallEnded(false); setCurrentCallType(type);
    setIsMicOn(true); setIsCamOn(true);
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(type));
      setStream(currentStream);
      const peer = new RTCPeerConnection(ICE_SERVERS); 
      connectionRef.current = peer;
      currentStream.getTracks().forEach(track => peer.addTrack(track, currentStream));
      peer.ontrack = (event) => setRemoteStream(event.streams[0]);
      peer.onicecandidate = (event) => { if (event.candidate) socket.emit("ice-candidate", { to: selectedUser, candidate: event.candidate }); };
      const offer = await peer.createOffer(); 
      await peer.setLocalDescription(offer);
      socket.emit("callUser", { userToCall: selectedUser, signal: offer, from: myProfile.username, callType: type });
    } catch (err) { console.error(err); leaveCall(); }
  };

  const answerCall = async () => {
    if (!callIncoming || !callIncoming.signal) return;
    setCallAccepted(true); 
    const type = callIncoming.callType || 'video'; 
    setCurrentCallType(type);
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(type));
      setStream(currentStream);
      const peer = new RTCPeerConnection(ICE_SERVERS); 
      connectionRef.current = peer;
      currentStream.getTracks().forEach(track => peer.addTrack(track, currentStream));
      peer.ontrack = (event) => setRemoteStream(event.streams[0]);
      peer.onicecandidate = (event) => { if (event.candidate) socket.emit("ice-candidate", { to: callIncoming.from, candidate: event.candidate }); };
      await peer.setRemoteDescription(new RTCSessionDescription(callIncoming.signal));
      const answer = await peer.createAnswer(); 
      await peer.setLocalDescription(answer);
      socket.emit("answerCall", { signal: answer, to: callIncoming.from });
    } catch (err) { console.error(err); leaveCall(); }
  };

  const leaveCall = () => {
    setCallEnded(true); setIsCalling(false); setCallAccepted(false); setCallIncoming(null); setRemoteStream(null); setStream(null);
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (connectionRef.current) { connectionRef.current.close(); connectionRef.current = null; }
    const target = selectedUser || (callIncoming ? callIncoming.from : null);
    if(target) socket.emit("endCall", { to: target });
  };

  const toggleMic = () => { if (stream) { const audioTrack = stream.getAudioTracks()[0]; if (audioTrack) { audioTrack.enabled = !audioTrack.enabled; setIsMicOn(audioTrack.enabled); } } };
  const toggleCam = () => { if (stream) { const videoTrack = stream.getVideoTracks()[0]; if (videoTrack) { videoTrack.enabled = !videoTrack.enabled; setIsCamOn(videoTrack.enabled); } } };

  // --- UTILS ---
  const getUserData = (username) => {
    if (username === myProfile.username) return myProfile;
    const onlineUser = allUsers.find(u => u.username === username);
    if (onlineUser) return onlineUser;
    return knownUsersCache[username] || { username: username, avatar: null, bio: "" };
  };
  const updateCache = (usersArray) => { setKnownUsersCache(prev => { const newCache = { ...prev }; usersArray.forEach(u => { if (u.username) newCache[u.username] = u; }); return newCache; }); };
  const handleLogin = () => {
    if (!tempUsername.trim() || !password.trim()) { alert("Введите имя и пароль"); return; }
    if (isRegisterMode) { socket.emit('register', { username: tempUsername, password }, (res) => { if (res.success) { alert(res.msg); setIsRegisterMode(false); } else { alert(res.msg); } }); } 
    else { socket.emit('login', { username: tempUsername, password }, (res) => { if (res.success) { setMyProfile({ username: res.username, avatar: res.avatar, bio: res.bio || "" }); setIsLoggedIn(true); socket.emit('get_contacts', res.username, (contacts) => { setMyContacts(contacts); }); } else { alert(res.msg); } }); }
  };
  const uploadFile = async (file) => {
    const formData = new FormData(); formData.append('file', file);
    try { const response = await fetch(`${SERVER_URL}/upload`, { method: 'POST', body: formData }); const data = await response.json(); return data.url; } catch (err) { console.error(err); return null; }
  };
  const handleAvatarUpload = async (e) => { const file = e.target.files[0]; if (file) { const url = await uploadFile(file); if (url) { setMyProfile(prev => ({ ...prev, avatar: url })); socket.emit('update_profile', { avatar: url }); } } };
  const handleBioUpdate = (newBio) => { setMyProfile(prev => ({ ...prev, bio: newBio })); socket.emit('update_profile', { bio: newBio }); };
  const sendMediaMessage = (url, fileName = null) => { if (selectedUser && url) { const msgData = { image: url, fileName: fileName, text: "", from: myProfile.username, to: selectedUser, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isMe: true }; socket.emit("send_private_message", msgData); } };
  const handleFileSend = async (e) => { const file = e.target.files[0]; if (file) { const url = await uploadFile(file); if (url) sendMediaMessage(url, file.name); } e.target.value = null; };
  const handleInput = (e) => { const text = e.target.value; setCurrentMessage(text); if (!selectedUser) return; socket.emit('typing', { to: selectedUser, from: myProfile.username }); if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current = setTimeout(() => { socket.emit('stop_typing', { to: selectedUser, from: myProfile.username }); }, 1000); };
  const sendMessage = async () => { if (currentMessage.trim() !== "" && selectedUser) { const msgData = { text: currentMessage, from: myProfile.username, to: selectedUser, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), isMe: true }; socket.emit("send_private_message", msgData); setCurrentMessage(""); socket.emit('stop_typing', { to: selectedUser, from: myProfile.username }); } };
  const updateChatHistory = (contactName, msg) => { setChats(prev => { const currentHistory = prev[contactName] || []; if (msg.id && currentHistory.some(m => m.id === msg.id)) { return { ...prev, [contactName]: currentHistory.map(m => m.id === msg.id ? { ...m, ...msg } : m) }; } return { ...prev, [contactName]: [...currentHistory, msg] }; }); };
  const handleAddReaction = (msgId, reaction) => { socket.emit('add_reaction', { messageId: msgId, reaction, username: myProfile.username, toUser: selectedUser }); setActiveReactionMessageId(null); };
  
  // 🔥 FIX: Явно передаем имя файла при остановке записи
  const startRecording = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mediaRecorder = new MediaRecorder(stream); mediaRecorderRef.current = mediaRecorder; audioChunksRef.current = []; mediaRecorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); }; mediaRecorder.onstop = async () => { const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); const file = new File([audioBlob], "voice_msg.webm", { type: "audio/webm" }); const url = await uploadFile(file); if (url) sendMediaMessage(url, "voice_msg.webm"); stream.getTracks().forEach(track => track.stop()); }; mediaRecorder.start(); setIsRecording(true); } catch (err) { console.error("Mic error:", err); alert("Нет доступа к микрофону!"); } };
  
  const stopRecording = () => { if (mediaRecorderRef.current && isRecording) { mediaRecorderRef.current.stop(); setIsRecording(false); } };
  const startChat = (username) => { if (!myContacts.includes(username)) setMyContacts(prev => [username, ...prev]); setSelectedUser(username); setSearchQuery(""); setIsTyping(false); socket.emit('get_history', { me: myProfile.username, other: username }, (history) => { if (history && Array.isArray(history)) { const formattedHistory = history.map(msg => ({ ...msg, isMe: msg.sender === myProfile.username })); setChats(prev => ({ ...prev, [username]: formattedHistory })); } }); };

  useEffect(() => {
    socket.on("users_update", (users) => { setAllUsers(users.filter(u => u.username !== myProfile.username)); updateCache(users); const me = users.find(u => u.username === myProfile.username); if(me) setMyProfile(prev => ({ ...prev, ...me })); });
    socket.on("receive_private_message", (data) => { if (data.from === myProfile.username && selectedUser === myProfile.username) return; playSound(); const msg = { ...data, isMe: false }; updateChatHistory(data.from, msg); if (!myContacts.includes(data.from)) setMyContacts(prev => [data.from, ...prev]); if (data.from === selectedUser) setIsTyping(false); });
    socket.on("message_sent_confirmation", (data) => { const msg = { ...data, isMe: true }; const targetChat = data.to === myProfile.username ? data.from : data.to; updateChatHistory(targetChat, msg); if (!myContacts.includes(targetChat)) setMyContacts(prev => [targetChat, ...prev]); });
    socket.on("reaction_updated", ({ messageId, reactions }) => { setChats(prev => { const newChats = { ...prev }; for (const user in newChats) newChats[user] = newChats[user].map(msg => msg.id === messageId ? { ...msg, reactions } : msg); return newChats; }); });
    socket.on('typing', ({ from }) => { if (selectedUser && from === selectedUser) setIsTyping(true); }); socket.on('stop_typing', ({ from }) => { if (selectedUser && from === selectedUser) setIsTyping(false); });
    socket.on("callUser", ({ from, signal, callType }) => { if (signal) { setCallIncoming({ from, signal, callType }); playSound('call'); } });
    socket.on("callAccepted", (signal) => { setCallAccepted(true); if(connectionRef.current) connectionRef.current.setRemoteDescription(new RTCSessionDescription(signal)); });
    socket.on("ice-candidate", (candidate) => { if(connectionRef.current) connectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); });
    socket.on("endCall", () => { leaveCall(); });
    return () => { socket.off("users_update"); socket.off("receive_private_message"); socket.off("message_sent_confirmation"); socket.off("reaction_updated"); socket.off("typing"); socket.off("stop_typing"); socket.off("callUser"); socket.off("callAccepted"); socket.off("ice-candidate"); socket.off("endCall"); };
  }, [myProfile.username, myContacts, settings.sound, selectedUser]);
  
  useEffect(() => { const timer = setTimeout(() => { if (searchQuery.trim() !== "") socket.emit('search_users', searchQuery, (users) => { setSearchResults(users.filter(u => u.username !== myProfile.username)); updateCache(users); }); else setSearchResults([]); }, 300); return () => clearTimeout(timer); }, [searchQuery, myProfile.username]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: settings.animations ? "smooth" : "auto" }); }, [chats, selectedUser, settings.animations, isTyping]);
  
  const UserAvatar = ({ username, size = 40 }) => { const data = getUserData(username); return <div className="avatar" style={{ width: size, height: size, minWidth: size }}>{data.avatar ? <img src={data.avatar} alt="ava" style={{width:'100%', height:'100%', objectFit:'cover', borderRadius:'50%'}} /> : <span>{data.username ? data.username[0].toUpperCase() : "?"}</span>}</div>; };
  if (!isLoggedIn) { return ( <div className="login-background"> <motion.div className="glass-card" initial={{scale:0.9, opacity:0}} animate={{scale:1, opacity:1}}> <div className="brand-title">Nexus</div> <div className="input-group" style={{display:'flex', flexDirection:'column', gap: 10}}> <input className="login-input" placeholder="Callsign" value={tempUsername} onChange={e => setTempUsername(e.target.value)} /> <input className="login-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === "Enter" && handleLogin()} /> </div> <button className="login-btn-glitch" onClick={handleLogin}>{isRegisterMode ? "Initialize" : "Connect"}</button> <div style={{marginTop: 15, fontSize: '0.8em', color: '#aaa', cursor: 'pointer'}} onClick={() => setIsRegisterMode(!isRegisterMode)}>{isRegisterMode ? "Create Identity" : "Login"}</div> </motion.div> </div> ); }

  const isSelectedUserOnline = selectedUser && allUsers.some(u => u.username === selectedUser);

  return (
    <div className="messenger-container" onClick={() => setActiveReactionMessageId(null)}>
      <AnimatePresence>
        {(isCalling || callAccepted) && (
           <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="call-overlay">
             <div className="video-container">
               {currentCallType === 'video' ? (
                 <>
                   {callAccepted && remoteStream ? (
                      <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                         <video playsInline ref={userVideo} autoPlay className="remote-video" />
                         {audioBlocked && (
                           <button onClick={forceUnmute} style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 1000, background: 'rgba(255, 0, 0, 0.8)', color: 'white', border: 'none', padding: '20px', borderRadius: '50%', cursor: 'pointer', boxShadow: '0 0 20px rgba(255,0,0,0.5)'}}>
                              <VolumeX size={40} /><div style={{fontSize: 12, marginTop: 5}}>ВКЛЮЧИТЬ ЗВУК</div>
                           </button>
                         )}
                      </div>
                   ) : (
                      <div className="calling-placeholder">
                        <UserAvatar username={selectedUser || callIncoming?.from} size={100} />
                        <h3>{callAccepted ? "Подключение..." : "Вызов..."}</h3>
                      </div>
                   )}
                   {stream && (
                     <motion.div drag dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }} className="local-video-wrapper">
                       <video playsInline muted ref={myVideo} autoPlay className="local-video" style={{ opacity: isCamOn ? 1 : 0 }} />
                       {!isCamOn && <div style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',background:'#333',display:'flex',justifyContent:'center',alignItems:'center',color:'#fff'}}><VideoOff size={24}/></div>}
                     </motion.div>
                   )}
                 </>
               ) : (
                 <div className="calling-placeholder">
                    <UserAvatar username={selectedUser || callIncoming?.from} size={150} />
                    <h2 style={{marginTop: 20}}>{callAccepted ? "Аудиозвонок" : "Вызов..."}</h2>
                 </div>
               )}
             </div>
             <div className="call-controls">
                <button className="call-btn" onClick={toggleMic} style={{background: isMicOn ? '#333' : '#fff', color: isMicOn ? '#fff' : '#000'}}>{isMicOn ? <Mic /> : <MicOff />}</button>
                {currentCallType === 'video' && (<button className="call-btn" onClick={toggleCam} style={{background: isCamOn ? '#333' : '#fff', color: isCamOn ? '#fff' : '#000'}}>{isCamOn ? <VideoIcon /> : <VideoOff />}</button>)}
                <button className="call-btn hangup" onClick={leaveCall}><PhoneOff size={32} /></button>
             </div>
           </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{callIncoming && !callAccepted && (<motion.div initial={{y:-100, opacity:0}} animate={{y:0, opacity:1}} exit={{y:-100, opacity:0}} className="incoming-call-card"><div style={{display:'flex', alignItems:'center', gap:15}}><UserAvatar username={callIncoming.from} size={50} /><div><div style={{fontWeight:'bold'}}>Входящий {callIncoming.callType === 'video' ? "Видео" : "Аудио"} звонок</div><div>{callIncoming.from}</div></div></div><div style={{display:'flex', gap:10}}><button className="call-btn accept" onClick={answerCall}><Phone size={20}/></button><button className="call-btn decline" onClick={() => { setCallIncoming(null); socket.emit('endCall', { to: callIncoming.from }); }}><PhoneOff size={20}/></button></div></motion.div>)}</AnimatePresence>
      <div className="sidebar" style={{position: 'relative'}}>
        <div className="sidebar-header"><div className="search-wrapper"><Search size={18} className="search-icon" /><input className="search-input" placeholder="Поиск..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div></div>
        <AnimatePresence>{searchResults.length > 0 && (<motion.div initial={{height:0, opacity:0}} animate={{height:"auto", opacity:1}} exit={{height:0, opacity:0}} className="search-results">{searchResults.map(user => (<div key={user.username} className="search-item" onClick={() => startChat(user.username)}><UserAvatar username={user.username} size={30} /><span>{user.username}</span></div>))}</motion.div>)}</AnimatePresence>
        <div className="users-list">
          {myContacts.length === 0 && <div style={{textAlign:'center', marginTop:20, opacity:0.5, fontSize:12}}>Нет чатов</div>}
          {myContacts.map(contactName => (<div key={contactName} className={`user-item ${selectedUser === contactName ? 'active' : ''}`} onClick={() => startChat(contactName)}><UserAvatar username={contactName} /><div className="user-info"><span className="user-name">{contactName}</span><span className="last-msg">{chats[contactName]?.slice(-1)[0]?.image ? "📎 Вложение" : (chats[contactName]?.slice(-1)[0]?.text || "Нет сообщений")}</span></div></div>))}
        </div>
        <div className="settings-panel" onClick={() => setProfileModalData(myProfile)} style={{cursor: 'pointer'}}><div style={{display:'flex', alignItems:'center', gap: 10}}><UserAvatar username={myProfile.username} size={35} /><div style={{display:'flex', flexDirection:'column'}}><b style={{fontSize: 14}}>{myProfile.username}</b></div></div><Settings size={18} color="var(--text-secondary)" /></div>
      </div>
      <div className="chat-area">
        {selectedUser ? (
          <>
            <div className="chat-topbar">
              <div style={{display: 'flex', alignItems: 'center', cursor: 'pointer'}} onClick={() => setProfileModalData(getUserData(selectedUser))}>
                <UserAvatar username={selectedUser} size={40} />
                <div style={{marginLeft: 10}}><h3 style={{margin:0, fontSize: '1.1em'}}>{selectedUser}</h3><div style={{display:'flex', alignItems:'center', gap: 5, marginTop: 2}}><div style={{width: 8, height: 8, borderRadius: '50%', background: isSelectedUserOnline ? '#00ff41' : '#666'}} /><span style={{fontSize: '0.8em', color: isSelectedUserOnline ? 'var(--accent)' : 'var(--text-secondary)'}}>{isTyping ? <span style={{color: 'var(--accent)', fontWeight: 'bold'}}>печатает...</span> : (isSelectedUserOnline ? 'online' : 'offline')}</span></div></div>
              </div>
              <div className="header-actions" style={{display:'flex', gap: 10}}>
                <button className="icon-btn" onClick={() => callUser('audio')}><Phone size={22} color="var(--accent)" /></button>
                <button className="icon-btn" onClick={() => callUser('video')}><VideoIcon size={24} color="var(--accent)" /></button>
              </div>
            </div>
            <div className="messages-list">
              <AnimatePresence>
                {(chats[selectedUser] || []).map((msg, idx) => (
                  <motion.div key={msg.id || idx} initial={settings.animations ? {opacity:0, y:10} : false} animate={{opacity:1, y:0}} className={`message-row ${msg.isMe ? 'me' : 'other'}`}>
                    <div className="message-container">
                      <div className="message-bubble" onContextMenu={(e) => { e.preventDefault(); setActiveReactionMessageId(msg.id); }}>
                        {msg.image && ((() => { 
                           const content = msg.image; 
                           const lower = content.toLowerCase();
                           
                           // 🔥 FIX: Проверяем fileName, который мы теперь явно передаем
                           const isVoice = (msg.fileName && msg.fileName.includes('voice_msg')) || lower.includes('voice_msg');

                           if (isVoice) {
                             return <VoiceMessage src={content} />;
                           }
                           
                           if (lower.endsWith('.mp4') || lower.endsWith('.webm')) {
                             return <video src={content} controls style={{maxWidth: '100%', maxHeight: '300px', borderRadius: '10px'}} />;
                           }
                           
                           return <img src={content} alt="img" className="msg-image" onClick={() => window.open(content, '_blank')} />;
                        })())}
                        {msg.text && <div>{msg.text}</div>}
                        <span className="msg-time">{msg.time}</span>
                        <div className="reaction-trigger" onClick={(e) => { e.stopPropagation(); setActiveReactionMessageId(activeReactionMessageId === msg.id ? null : msg.id); }}><Smile size={14} /></div>
                      </div>
                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (<div className="reactions-display">{Object.entries(msg.reactions).map(([r, u]) => (<div key={r} className={`reaction-pill ${u.includes(myProfile.username) ? 'active' : ''}`} onClick={() => handleAddReaction(msg.id, r)}>{r} <span style={{fontSize:'0.8em', marginLeft:2}}>{u.length}</span></div>))}</div>)}
                      {activeReactionMessageId === msg.id && (<motion.div initial={{scale:0}} animate={{scale:1}} className="reaction-menu">{AVAILABLE_REACTIONS.map(r => (<span key={r} onClick={() => handleAddReaction(msg.id, r)}>{r}</span>))}</motion.div>)}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
            <div className="input-box">
              <label className="icon-btn"><Paperclip size={20} color="var(--text-secondary)" /><input type="file" hidden onChange={handleFileSend} /></label>
              <input placeholder={isRecording ? "Запись голоса..." : "Сообщение..."} value={currentMessage} onChange={handleInput} onKeyPress={e => e.key === "Enter" && sendMessage()} disabled={isRecording} style={isRecording ? {backgroundColor: 'rgba(255,0,0,0.1)', borderColor: 'red'} : {}} />
              <button onClick={isRecording ? stopRecording : startRecording} style={{ background: 'none', border: isRecording ? '1px solid #ff4444' : 'none', color: isRecording ? '#ff4444' : 'var(--text-secondary)', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 5, cursor: 'pointer', animation: isRecording ? 'pulse 1.5s infinite' : 'none' }}>{isRecording ? <Square size={20} fill="#ff4444" /> : <Mic size={22} />}</button>
              <button onClick={sendMessage}><Send size={20} /></button>
            </div>
          </>
        ) : ( <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', opacity:0.5}}><h2>Nexus Messenger</h2></div> )}
      </div>
      <AnimatePresence>
        {profileModalData && (
          <>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="modal-overlay" onClick={() => setProfileModalData(null)} />
            <motion.div initial={{scale:0.8, opacity:0}} animate={{scale:1, opacity:1}} exit={{scale:0.8, opacity:0}} className="modal-content">
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20}}>
                <h2>{profileModalData.username === myProfile.username ? "Настройки" : "Профиль"}</h2>
                <button className="icon-btn" onClick={() => setProfileModalData(null)}><X /></button>
              </div>
              <div className="settings-section center">
                <div className="avatar-upload-wrapper">
                  <UserAvatar username={profileModalData.username} size={100} />
                  {profileModalData.username === myProfile.username && (<><label htmlFor="avatar-input" className="upload-btn"><Camera size={18} /></label><input id="avatar-input" type="file" hidden accept="image/*" onChange={handleAvatarUpload} /></>)}
                </div>
              </div>
              <div className="settings-section" style={{textAlign: 'center'}}>
                <h2 style={{margin: '10px 0'}}>{profileModalData.username}</h2>
                {profileModalData.username === myProfile.username ? (
                  <div className="input-with-icon"><Edit2 size={16} /><input value={myProfile.bio} onChange={(e) => handleBioUpdate(e.target.value)} placeholder="Ваш статус..." /></div>
                ) : (
                  <p style={{color: 'var(--text-secondary)', fontStyle: 'italic'}}>{getUserData(profileModalData.username).bio || "Статус не установлен"}</p>
                )}
              </div>
              {profileModalData.username === myProfile.username && (
                <div style={{maxHeight: '300px', overflowY: 'auto', paddingRight: '5px'}}>
                   <div className="settings-section">
                     <label>Тема оформления</label>
                     <div className="theme-grid">
                       {['default', 'neon', 'light', 'dracula', 'ocean', 'matrix', 'sunset'].map(t => (
                         <div key={t} className={`theme-opt ${settings.theme === t ? 'active' : ''}`} onClick={() => setSettings({...settings, theme: t})}>{t}</div>
                       ))}
                     </div>
                   </div>
                   <div className="settings-section">
                     <label><Type size={14} style={{marginRight:5}}/> Размер шрифта</label>
                     <div className="theme-switcher">
                       {['small', 'medium', 'large'].map(s => (
                         <div key={s} className={`theme-opt ${settings.fontSize === s ? 'active' : ''}`} onClick={() => setSettings({...settings, fontSize: s})}>{s.toUpperCase()}</div>
                       ))}
                     </div>
                   </div>
                   <div className="settings-section" style={{display:'flex', gap: 20}}>
                     <div className="toggle-item" onClick={() => setSettings({...settings, sound: !settings.sound})}> 
                       {settings.sound ? <Volume2 size={20} color="var(--accent)"/> : <VolumeX size={20} />} <span>Звуки</span> 
                     </div>
                     <div className="toggle-item" onClick={() => setSettings({...settings, animations: !settings.animations})}> 
                       <Zap size={20} color={settings.animations ? "var(--accent)" : "gray"} /> <span>Анимации</span> 
                     </div>
                   </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
