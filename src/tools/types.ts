import type {TokenProvider} from '../utils/contacts-api.js';

export type Config = {
	/** Google OAuth access token, or a function that returns a currently valid one */
	token: string | TokenProvider;
};
