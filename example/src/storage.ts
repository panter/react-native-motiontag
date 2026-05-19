import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'motiontag_jwt'

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY)
  } catch {
    return null
  }
}

export async function saveToken(jwt: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, jwt)
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}
