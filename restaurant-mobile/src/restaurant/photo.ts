import * as ImagePicker from 'expo-image-picker';
import { restaurantApi } from './api';

export async function chooseRestaurantPhoto(restaurantId: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: .85 });
  if (result.canceled || !result.assets[0]) return null;
  const photo = result.assets[0];
  const form = new FormData();
  form.append('file', { uri: photo.uri, name: photo.fileName || 'restaurant-photo.jpg', type: photo.mimeType || 'image/jpeg' } as any);
  return (await restaurantApi.request<{ url: string }>(`/${restaurantId}/media`, 'POST', form)).url;
}
