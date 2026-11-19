/**
 * #26: exit code of the server when port 3210 is already served by another instance of this
 * system. The launcher then stops instead of restarting (nothing is wrong).
 */
export const ALREADY_RUNNING_EXIT_CODE = 3;
