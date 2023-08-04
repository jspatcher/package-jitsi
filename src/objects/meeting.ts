import JitsiMeetJS from "@shren/lib-jitsi-meet";
import JitsiObject from "./base";
import { isBang } from "../sdk";
import serverOptions from "../ServerOptions";
import type JitsiConference from "@shren/lib-jitsi-meet/types/hand-crafted/JitsiConference";
import type JitsiConnection from "@shren/lib-jitsi-meet/types/hand-crafted/JitsiConnection";
import type JitsiRemoteTrack from "@shren/lib-jitsi-meet/types/hand-crafted/modules/RTC/JitsiRemoteTrack";
import type JitsiLocalTrack from "@shren/lib-jitsi-meet/types/hand-crafted/modules/RTC/JitsiLocalTrack";
import type { IArgsMeta, IInletsMeta, IOutletsMeta, IPropsMeta } from "@jspatcher/jspatcher/src/core/objects/base/AbstractObject";

JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);

interface P {
    opusMaxAverageBitrate: number;
    username: string;
}

interface IS {
    audioInStreamNode: MediaStreamAudioDestinationNode;
    audioOutGainNode: GainNode;
    connection: JitsiConnection;
    room: JitsiConference;
    streamMap: Record<string, Set<MediaStreamAudioSourceNode>>;
    audioMap: Record<string, Set<HTMLAudioElement>>;
    localTrack: JitsiLocalTrack;
}

interface TextMessage {
    username?: string;
    userId?: string;
    message: string;
    timestamp?: number;
    private?: boolean;
}

export default class Meeting extends JitsiObject<[string | TextMessage], [TextMessage, JitsiConference], [string], P> {
    static description = "Send/Receive Audio or Text Message to a Jitsi Meeting";
    static inlets: IInletsMeta = [{
        isHot: true,
        type: "signal",
        description: "Audio to send, text string to broadcast, { username: string; message: string } to send private message"
    }];
    static outlets: IOutletsMeta = [{
        type: "signal",
        description: "Audio and text received, text message under format { username: string; message: string }"
    }, {
        type: "object",
        description: "The JitsiConference instance"
    }];
    static args: IArgsMeta = [{
        type: "string",
        optional: true,
        description: "Jitsi Meeting Name",
        default: `jspatcher${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`
    }];
    static props: IPropsMeta<P> = {
        opusMaxAverageBitrate: {
            type: "number",
            description: "Jitsi audio quality, Value to fit the 6000 to 510000 range",
            default: 48000
        },
        username: {
            type: "string",
            description: "Jitsi display username in the room",
            default: `JSPatcher User ${Math.random().toFixed(3).slice(2)}`
        }
    };
    _: IS = {
        audioInStreamNode: this.audioCtx.createMediaStreamDestination(),
        audioOutGainNode: this.audioCtx.createGain(),
        connection: null,
        room: null,
        streamMap: {},
        audioMap: {},
        localTrack: null
    };
    handleRemoteTrackAdded = (track: JitsiRemoteTrack) => {
        if (track.isLocal()) return;
        if (track.getType() !== "audio") return;
        const participant = track.getParticipantId();
        const stream = track.getOriginalStream();
        const audio = new Audio();
        audio.muted = true;
        audio.srcObject = stream;
        const streamSourceNode = this.audioCtx.createMediaStreamSource(audio.srcObject);
        audio.play();
        if (!this._.streamMap[participant]) this._.streamMap[participant] = new Set([streamSourceNode]);
        else this._.streamMap[participant].add(streamSourceNode);
        if (!this._.audioMap[participant]) this._.audioMap[participant] = new Set([audio]);
        else this._.audioMap[participant].add(audio);
        streamSourceNode.connect(this._.audioOutGainNode);
        track.addEventListener(JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED, () => {
            this._.streamMap[participant]?.delete(streamSourceNode);
            this._.audioMap[participant]?.delete(audio);
            streamSourceNode.disconnect();
            audio.pause();
        });
    };
    handleRemoteTrackRemoved = (track: JitsiRemoteTrack) => {
        const participant = track.getParticipantId();
        if (!participant) return;
        const stream = track.getOriginalStream();
        const streamSourceNode = [...this._.streamMap[participant]].find(node => node.mediaStream === stream);
        const audio = [...this._.audioMap[participant]].find(audio => audio.srcObject === stream);
        if (streamSourceNode) this._.streamMap[participant]?.delete(streamSourceNode);
        if (audio) this._.audioMap[participant]?.delete(audio);
        streamSourceNode?.disconnect();
        audio?.pause();
    };
    handleUserLeft = (id: string) => {
        if (this._.streamMap[id]) {
            [...this._.streamMap[id]].forEach(node => node.disconnect());
            this._.streamMap[id].clear();
        }
        if (this._.audioMap[id]) {
            [...this._.audioMap[id]].forEach(audio => audio.pause());
            this._.audioMap[id].clear();
        }
    }
    handleConferenceJoined = async () => {
        const [track] = JitsiMeetJS.util.RTC.createLocalTracks([{
            mediaType: "audio",
            stream: this._.audioInStreamNode.stream,
            track: this._.audioInStreamNode.stream.getAudioTracks()[0]
        }]);
        this._.localTrack = track;
        this._.room._setupNewTrack(track);
        await this._.room.addTrack(track);
        track.unmute();
    };
    handleMessageReceived = (userId: string, message: string, timestamp: number) => {
        const username = this._.room.getParticipantById(userId)?.getDisplayName();
        this.outlet(0, { username, userId, message, timestamp, private: false });
    };
    handlePrivateMessageReceived = (userId: string, message: string, timestamp: number) => {
        const username = this._.room.getParticipantById(userId)?.getDisplayName();
        this.outlet(0, { username, userId, message, timestamp, private: true });
    };
    handleConnectionSuccess = () => {
        const confOptions = {};        
        const room = this._.connection.initJitsiConference(this.args[0], confOptions);
        this._.room = room;
        this.outlet(1, room);
        room.on(JitsiMeetJS.events.conference.TRACK_ADDED, this.handleRemoteTrackAdded);
        room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, this.handleRemoteTrackRemoved);
        room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, this.handleConferenceJoined);
        // room.on(JitsiMeetJS.events.conference.USER_JOINED, id => console.log('user join'));
        room.on(JitsiMeetJS.events.conference.MESSAGE_RECEIVED, this.handleMessageReceived);
        room.on(JitsiMeetJS.events.conference.PRIVATE_MESSAGE_RECEIVED, this.handlePrivateMessageReceived);
        room.on(JitsiMeetJS.events.conference.USER_LEFT, this.handleUserLeft);
        // room.on(JitsiMeetJS.events.conference.TRACK_MUTE_CHANGED, track => console.log(`${track.getType()} - ${track.isMuted()}`));
        // room.on(JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED, (userID, displayName) => console.log(`${userID} - ${displayName}`));
        // room.on( JitsiMeetJS.events.conference.TRACK_AUDIO_LEVEL_CHANGED, (userID, audioLevel) => console.log(`${userID} - ${audioLevel}`));
        // room.on(JitsiMeetJS.events.conference.PHONE_NUMBER_CHANGED, () => console.log(`${room.getPhoneNumber()} - ${room.getPhonePin()}`));
        room.setDisplayName(this.getProp("username"));
        room.join(null);
    };
    handleConnectionFailed = () => {
        this.error("Connection Failed.");
        this.handleConnectionDisconnect();
    };
    handleConnectionDisconnect = async () => {
        this._.room?.off(JitsiMeetJS.events.conference.TRACK_ADDED, this.handleRemoteTrackAdded);
        this._.room?.off(JitsiMeetJS.events.conference.TRACK_REMOVED, this.handleRemoteTrackRemoved);
        this._.room?.off(JitsiMeetJS.events.conference.CONFERENCE_JOINED, this.handleConferenceJoined);
        this._.room?.off(JitsiMeetJS.events.conference.MESSAGE_RECEIVED, this.handleMessageReceived);
        this._.room?.off(JitsiMeetJS.events.conference.MESSAGE_RECEIVED, this.handlePrivateMessageReceived);
        this._.room?.off(JitsiMeetJS.events.conference.USER_LEFT, this.handleUserLeft);
        this._.connection?.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, this.handleConnectionSuccess);
        this._.connection?.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, this.handleConnectionFailed);
        this._.connection?.removeEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, this.handleConnectionDisconnect);
        for (const id in this._.streamMap) {
            [...this._.streamMap[id]].forEach(node => node.disconnect());
            this._.streamMap[id].clear();
        }
        for (const id in this._.audioMap) {
            [...this._.audioMap[id]].forEach(audio => audio.pause());
            this._.audioMap[id].clear();
        }
        await this._.localTrack?.mute();
        await this._.localTrack?.dispose();
        await this._.room?.leave();
        await this._.connection?.disconnect();
        this._.localTrack = undefined;
        this._.connection = undefined;
        this._.room = undefined;
    };
    connect = () => {
        const connection = new JitsiMeetJS.JitsiConnection(null, null, serverOptions);
        this._.connection = connection;
        connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED, this.handleConnectionSuccess);
        connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_FAILED, this.handleConnectionFailed);
        connection.addEventListener(JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED, this.handleConnectionDisconnect);
        connection.connect({});
    }
    subscribe() {
        super.subscribe();
        this.on("preInit", () => {
            this.inlets = 1;
            this.outlets = 2;
            this.inletAudioConnections = [{ node: this._.audioInStreamNode, index: 0 }];
            this.outletAudioConnections = [{ node: this._.audioOutGainNode, index: 0 }];
        });
        this.on("postInit", () => {
            JitsiMeetJS.init({
                disableAudioLevels: true,
                audioQuality: {
                    stereo: false,
                    opusMaxAverageBitrate: ~~+this.getProp("opusMaxAverageBitrate"),
                    enableOpusDtx: false
                }
            } as any);
            this.connect();
        });
        this.on("argsUpdated", async ({ args }) => {
            await this.handleConnectionDisconnect();
            this.connect();
        });
        this.on("propsUpdated", ({ props: { username } }) => {
            if (username) this._.room?.setDisplayName(username);
        });
        this.on("destroy", async () => {
            await this.handleConnectionDisconnect();
            await this._.room?.leave();
            await this._.connection?.disconnect();
        })
        this.on("inlet", async ({ data, inlet }) => {
            if (inlet === 0) {
                if (isBang(data)) {
                    if (!this._.connection) this.connect();
                    else this.outlet(1, this._.room);
                } else if (typeof data === "string") {
                    if (this._.room) {
                        this._.room.sendMessage(data);
                    }
                } else if (typeof data === "object") {
                    if (this._.room) {
                        if (data.userId) {
                            this._.room.sendMessage(data.message, data.userId);
                        } else {
                            const id = this._.room.getParticipants().find(p => p.getDisplayName() === data.username).getId();
                            if (id) this._.room.sendMessage(data.message, id);
                        }
                    }
                }
            }
        });
    }
}
