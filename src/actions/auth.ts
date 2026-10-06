'use server';

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { connectToDatabase, User, Build } from '../lib/db';

const JWT_SECRET = process.env.SUPER_KEY || 'default_fallback_secret';

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  
  await connectToDatabase();
  const user = await User.findOne({ email });
  if (!user) return { error: 'Invalid email or password' };
  
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) return { error: 'Invalid email or password' };
  
  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  return { success: true, token };
}

export async function signup(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const name = formData.get('name') as string;
  
  
  await connectToDatabase();
  const existingUser = await User.findOne({ email });
  if (existingUser) return { error: 'Email already exists' };
  
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  
  const newUser = await User.create({
    email,
    passwordHash,
    name
  });
  
  const emptyData = { rooms: [], walls: [], surfaces: [], doors: [], windows: [], assets: [] };
  await Build.insertMany([
    { userId: newUser._id, planId: 'p1', data: emptyData },
    { userId: newUser._id, planId: 'p2', data: emptyData }
  ]);
  
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  return { success: true, token };
}

export async function getUserFromToken(token: string) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    await connectToDatabase();
    const user = await User.findOne({ email: decoded.email }).lean() as any;
    if (!user) return null;
    
    const builds = await Build.find({ userId: user._id }).lean() as any[];
    const emptyData = { rooms: [], walls: [], surfaces: [], doors: [], windows: [], assets: [] };
    
    user.builds = {
      p1: builds.find(b => b.planId === 'p1')?.data || emptyData,
      p2: builds.find(b => b.planId === 'p2')?.data || emptyData
    };
    
    return JSON.parse(JSON.stringify(user));
  } catch (error) {
    return null;
  }
}
