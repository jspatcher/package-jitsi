import { author, name, version, description } from "../index";
import { DefaultObject } from "../sdk";

export default class JitsiObject<I extends any[] = any[], O extends any[] = [any], A extends any[] = any[], P = {}> extends DefaultObject<{}, {}, I, O, A, P> {
    static package = name;
    static author = author;
    static version = version;
    static description = description;
}
