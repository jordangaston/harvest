import { Tabs } from "expo-router";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Grain } from "../../components/recime/Grain";

const ACTIVE = "#A85E2B";
const INACTIVE = "#6E5B48";

// Main app shell — bottom tabs matching the Harvest home experience.
export default function AppTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: "#F1E6D2",
          borderTopColor: "#6E5B48",
          borderTopWidth: 1.5,
          height: 88,
          paddingTop: 6,
        },
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
            <Grain />
          </View>
        ),
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => <Ionicons name="compass-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: "Recipes",
          tabBarIcon: ({ color }) => <Ionicons name="bookmark-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="meal-plan"
        options={{
          title: "Meal Plan",
          tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="groceries"
        options={{
          title: "Groceries",
          tabBarIcon: ({ color }) => <Ionicons name="cart-outline" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
