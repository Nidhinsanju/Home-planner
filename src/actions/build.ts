'use server';

import jwt from 'jsonwebtoken';
import { connectToDatabase, User, Build, BuildData } from '../lib/db';

const JWT_SECRET = process.env.SUPER_KEY || 'default_fallback_secret';

export async function saveBuild(planId: 'p1' | 'p2', buildData: BuildData, token: string) {
  if (!token) return { error: 'Not logged in' };
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    await connectToDatabase();
    const user = await User.findOne({ email: decoded.email });
    if (!user) return { error: 'User not found' };
    
    await Build.findOneAndUpdate(
      { userId: user._id, planId },
      { $set: { data: buildData } },
      { upsert: true, new: true }
    );
    
    return { success: true };
  } catch (err) {
    return { error: 'Invalid token' };
  }
}
