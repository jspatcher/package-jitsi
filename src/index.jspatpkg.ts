import meeting from "./objects/meeting";
import Jitsi from "@shren/lib-jitsi-meet";
import { DefaultImporter } from "./sdk";

export default async () => {
    return {
        meeting,
        ...DefaultImporter.import("jitsi", Jitsi)
    }
};