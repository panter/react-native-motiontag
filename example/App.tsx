import React, { useEffect, useState } from 'react'
import {
  Alert,
  FlatList,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Location from 'expo-location'
import MotionTag from '@panter/react-native-motiontag'

import { loadToken, saveToken } from './src/storage'
import { useTrackingState } from './src/useTrackingState'
import { useEventLog } from './src/useEventLog'

type PermissionState = 'unknown' | 'granted' | 'partial' | 'denied'

export default function App() {
  const [token, setToken] = useState('')
  const [permState, setPermState] = useState<PermissionState>('unknown')
  const [batteryOpt, setBatteryOpt] = useState<boolean | null>(null)
  const [powerSave, setPowerSave] = useState<boolean | null>(null)
  const { active, refresh } = useTrackingState()
  const log = useEventLog()

  useEffect(() => {
    void (async () => {
      const stored = await loadToken()
      if (stored) {
        setToken(stored)
        try {
          await MotionTag.setUserToken(stored)
        } catch {
          // ignore — surfaces in the log via 'log' events if relevant
        }
      }
      await refresh()
      await refreshAndroidStatus()
      await refreshPermissions()
    })()
  }, [])

  const refreshAndroidStatus = async () => {
    if (Platform.OS !== 'android') return
    try {
      setBatteryOpt(await MotionTag.isBatteryOptimizationsEnabled())
      setPowerSave(await MotionTag.isPowerSaveModeEnabled())
    } catch {
      // ignore
    }
  }

  const refreshPermissions = async () => {
    const fg = await Location.getForegroundPermissionsAsync()
    if (!fg.granted) {
      setPermState('denied')
      return
    }
    const bg = await Location.getBackgroundPermissionsAsync()
    setPermState(bg.granted ? 'granted' : 'partial')
  }

  const requestPermissions = async () => {
    const fg = await Location.requestForegroundPermissionsAsync()
    if (!fg.granted) {
      setPermState('denied')
      Alert.alert('Permission denied', 'Foreground location is required.')
      return
    }
    const bg = await Location.requestBackgroundPermissionsAsync()
    if (Platform.OS === 'android') {
      if (Platform.Version >= 29) {
        await PermissionsAndroid.request(
          'android.permission.ACTIVITY_RECOGNITION' as any,
        )
      }
      if (Platform.Version >= 33) {
        await PermissionsAndroid.request(
          'android.permission.POST_NOTIFICATIONS' as any,
        )
      }
    }
    setPermState(bg.granted ? 'granted' : 'partial')
  }

  const handleSaveToken = async () => {
    const trimmed = token.trim()
    if (!trimmed) {
      Alert.alert('Token required', 'Paste a MotionTag JWT first.')
      return
    }
    try {
      await saveToken(trimmed)
      await MotionTag.setUserToken(trimmed)
      Alert.alert('Token saved')
    } catch (e: any) {
      Alert.alert('Failed to save token', String(e?.message ?? e))
    }
  }

  const handleStart = async () => {
    try {
      await MotionTag.start()
      await refresh()
      await refreshAndroidStatus()
    } catch (e: any) {
      Alert.alert('Start failed', String(e?.message ?? e))
    }
  }

  const handleStop = async () => {
    try {
      await MotionTag.stop()
      await refresh()
    } catch (e: any) {
      Alert.alert('Stop failed', String(e?.message ?? e))
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>MotionTag Demo</Text>

      <View style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}>
        <Text style={styles.pillText}>{active ? 'Tracking active' : 'Inactive'}</Text>
      </View>

      <Section title="MotionTag JWT">
        <TextInput
          style={styles.input}
          placeholder="Paste your MotionTag JWT here"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          value={token}
          onChangeText={setToken}
        />
        <Button label="Save token" onPress={handleSaveToken} />
      </Section>

      <Section title="Permissions">
        <Text style={styles.statusLine}>
          Status:{' '}
          <Text style={styles.statusValue}>
            {permState === 'granted'
              ? 'Always (background)'
              : permState === 'partial'
                ? 'When in use only'
                : permState === 'denied'
                  ? 'Denied'
                  : 'Unknown'}
          </Text>
        </Text>
        <Button label="Request permissions" onPress={requestPermissions} />
      </Section>

      <Section title="Tracking">
        <Button
          label={active ? 'Stop tracking' : 'Start tracking'}
          onPress={active ? handleStop : handleStart}
          tone={active ? 'danger' : 'primary'}
        />
      </Section>

      {Platform.OS === 'android' && (
        <Section title="Android health">
          <Text style={styles.statusLine}>
            Battery optimisations:{' '}
            <Text style={styles.statusValue}>
              {batteryOpt === null ? '—' : batteryOpt ? 'ON (may stop tracking)' : 'off'}
            </Text>
          </Text>
          <Text style={styles.statusLine}>
            Power-save mode:{' '}
            <Text style={styles.statusValue}>
              {powerSave === null ? '—' : powerSave ? 'ON (may stop tracking)' : 'off'}
            </Text>
          </Text>
          <Button label="Refresh" onPress={refreshAndroidStatus} />
        </Section>
      )}

      <Section title={`Event log (${log.length})`}>
        <FlatList
          scrollEnabled={false}
          data={log}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => (
            <View style={styles.logRow}>
              <Text style={styles.logTime}>{item.time}</Text>
              <Text style={styles.logType}>{item.type}</Text>
              {item.payload ? (
                <Text style={styles.logPayload} numberOfLines={2}>
                  {item.payload}
                </Text>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No events yet — start tracking to see activity.</Text>
          }
        />
      </Section>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Button({
  label,
  onPress,
  tone = 'primary',
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'danger'
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        tone === 'danger' ? styles.buttonDanger : styles.buttonPrimary,
        pressed && styles.buttonPressed,
      ]}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 56,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  pill: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  pillActive: { backgroundColor: '#1f7a3a' },
  pillIdle: { backgroundColor: '#666' },
  pillText: { color: 'white', fontWeight: '600' },
  section: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f4f4f5',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    minHeight: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    backgroundColor: 'white',
    padding: 10,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 13,
    textAlignVertical: 'top',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonPrimary: { backgroundColor: '#2563eb' },
  buttonDanger: { backgroundColor: '#dc2626' },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: 'white', fontWeight: '600' },
  statusLine: { fontSize: 14 },
  statusValue: { fontWeight: '600' },
  logRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d4d4d8',
  },
  logTime: { fontSize: 11, color: '#71717a' },
  logType: { fontSize: 14, fontWeight: '600' },
  logPayload: {
    fontSize: 12,
    color: '#3f3f46',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  empty: {
    color: '#71717a',
    fontStyle: 'italic',
    padding: 8,
  },
})
