import { auth } from "@/server/auth/auth";
import { ConfigurationError } from "@/server/runtime";

const handler = async (request: Request) => {
  try {
    return await auth().handler(request);
  } catch (error) {
    if (error instanceof ConfigurationError) return Response.json({ error: { code: "SERVICE_UNAVAILABLE", message: error.message } }, { status: 503 });
    throw error;
  }
};
export const GET = handler;
export const POST = handler;
