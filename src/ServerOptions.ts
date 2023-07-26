import { JitsiConferenceOptions } from "@shren/lib-jitsi-meet/types/hand-crafted/JitsiConnection";

const serverOptions: JitsiConferenceOptions = {
    hosts: {
        domain: 'meet.jit.si',
        focus: 'focus.meet.jit.si',
        muc: 'conference.meet.jit.si'
    },
    bosh: 'https://meet.jit.si/http-bind'
};

export default serverOptions;
