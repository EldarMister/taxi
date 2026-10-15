import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { StatusBar } from 'expo-status-bar';
import { RestaurantApp } from './src/app/RestaurantApp';
export default function App(){const [loaded,error]=useFonts({Inter_400Regular,Inter_500Medium,Inter_600SemiBold,Inter_700Bold});return <SafeAreaProvider><StatusBar style="dark"/><RestaurantApp ready={!!(loaded||error)}/></SafeAreaProvider>;}
