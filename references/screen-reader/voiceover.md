# VoiceOver (iOS/SwiftUI) Properties Reference

## Core Modifiers

| Modifier | Use When |
|----------|----------|
| `.accessibilityLabel("text")` | Set spoken name |
| `.accessibilityValue("text")` | Set current value |
| `.accessibilityHint("text")` | Describe action result |
| `.accessibilityIdentifier("id")` | UI testing only (not announced) |
| `.accessibilityHidden(true)` | Hide from VoiceOver |
| `.accessibilityRepresentation { }` | Replace custom view's a11y with standard control |
| `.accessibilityTextContentType(.plain)` | Text content type hint |
| `.accessibilityShowsLargeContentViewer()` | Support large content viewer |

---

## Traits

| Modifier | Use When |
|----------|----------|
| `.accessibilityAddTraits(.isButton)` | Tappable action |
| `.accessibilityAddTraits(.isLink)` | Navigation link |
| `.accessibilityAddTraits(.isImage)` | Image content |
| `.accessibilityAddTraits(.isStaticText)` | Non-interactive text |
| `.accessibilityAddTraits(.isSearchField)` | Search input |
| `.accessibilityAddTraits(.isHeader)` | Section header |
| `.accessibilityAddTraits(.isSelected)` | Currently selected |
| `.accessibilityAddTraits(.isToggle)` | Toggle control |
| `.accessibilityAddTraits(.startsMediaSession)` | Starts media |
| `.accessibilityAddTraits(.allowsDirectInteraction)` | Bypass VoiceOver touch |
| `.accessibilityAddTraits(.updatesFrequently)` | Reduces announcements |
| `.accessibilityAddTraits(.playsSound)` | Element plays sound |
| `.accessibilityAddTraits(.causesPageTurn)` | Triggers page turn |
| `.accessibilityAddTraits(.isTabBar)` | Custom tab bar (iOS 17+) |
| `.accessibilityAddTraits(.isSummaryElement)` | Brief summary of screen state (like Weather app) |
| `.accessibilityAddTraits(.isKeyboardKey)` | Custom keyboard key (suppresses "button") |
| `.accessibilityRemoveTraits(.isButton)` | Remove trait |

### Combining Traits
```swift
.accessibilityAddTraits([.isButton, .isSelected])
```

---

## Adjustable Values

For sliders, steppers, pickers:

```swift
.accessibilityValue("50 percent")
.accessibilityAdjustableAction { direction in
    switch direction {
    case .increment: value += 10
    case .decrement: value -= 10
    @unknown default: break
    }
}
```

---

## Actions

| Modifier | Use When |
|----------|----------|
| `.accessibilityAction(.default) { }` | Override tap |
| `.accessibilityAction(.escape) { }` | Handle dismiss gesture |
| `.accessibilityAction(.magicTap) { }` | Two-finger double-tap |

### Custom Actions
```swift
.accessibilityAction(named: "Delete") { deleteItem() }
.accessibilityAction(named: "Share") { shareItem() }

// Multiple actions at once
.accessibilityActions {
    Button("Delete") { deleteItem() }
    Button("Share") { shareItem() }
}
```

### Zoom Action (iOS 17+)
```swift
.accessibilityZoomAction { action in
    switch action.direction {
    case .zoomIn: scale += 0.5
    case .zoomOut: scale -= 0.5
    @unknown default: break
    }
}
```

### Drag & Drop (iOS 18+)
```swift
.accessibilityDragPoint(.leading)
.accessibilityDropPoint(.trailing)
```

---

## Input Labels (Voice Control)

```swift
.accessibilityInputLabels(["Submit", "Send", "Done"])
```

---

## Grouping & Containers

| Modifier | Use When |
|----------|----------|
| `.accessibilityElement(children: .combine)` | Merge children into one |
| `.accessibilityElement(children: .contain)` | Keep children separate |
| `.accessibilityElement(children: .ignore)` | Hide children |

### Combined Element
```swift
HStack {
    Image(systemName: "star")
    Text("Favorites")
}
.accessibilityElement(children: .combine)
```

### Custom Label for Group
```swift
HStack { ... }
.accessibilityElement(children: .ignore)
.accessibilityLabel("5 stars, rated excellent")
```

### Linked Elements
```swift
Text("Email")
    .accessibilityLinkedGroup(id: "email")
TextField("Enter email", text: $email)
    .accessibilityLinkedGroup(id: "email")
```

### Direct Touch (bypass VoiceOver)
```swift
.accessibilityDirectTouch(options: .silentOnTouch)
```

---

## Focus Management

| Method | Use When |
|--------|----------|
| `@AccessibilityFocusState` | Track/set VoiceOver focus |
| `.accessibilityFocused($focusState)` | Bind focus to view |

```swift
@AccessibilityFocusState private var isFocused: Bool

Text("Error message")
    .accessibilityFocused($isFocused)

// Move focus
isFocused = true
```

---

## Announcements

```swift
AccessibilityNotification.Announcement("Item deleted").post()
```

---

## Containers & Landmarks

| Modifier | Use When |
|----------|----------|
| `.accessibilityElement(children: .contain)` | Container with children |
| `.accessibilityAddTraits(.isHeader)` | Section heading |

---

## Sorting & Order

```swift
.accessibilitySortPriority(1) // Higher = earlier
```

---

## Rotor

```swift
.accessibilityRotor("Headings") {
    ForEach(headings) { heading in
        AccessibilityRotorEntry(heading.title, id: heading.id)
    }
}
```

---

## Modal Views

```swift
.accessibilityAddTraits(.isModal)
```

---

## Charts (iOS 15+)

```swift
Chart(data) { item in
    BarMark(x: .value("Month", item.month), y: .value("Sales", item.sales))
}
.accessibilityChartDescriptor(self)

// Implement AXChartDescriptorRepresentable
extension MyView: AXChartDescriptorRepresentable {
    func makeChartDescriptor() -> AXChartDescriptor {
        // Provide chart description for VoiceOver
    }
}
```

---

## Announcement Order

VoiceOver announces in this order:
1. Label
2. Value
3. Traits
4. Hint

---

## Best Practices

### Labels
- Be concise (1-3 words)
- Don't include type ("button", "image")
- Don't include state (use traits)

### Hints
- Describe result, not action
- Start with verb ("Opens settings")
- Only add if not obvious

### Grouping
- Combine related elements to reduce swipes
- Provide single descriptive label for groups

---

## Common Patterns

### Button
```swift
Button("Submit") { }
// VoiceOver: "Submit, button"
```

### Toggle
```swift
Toggle("Notifications", isOn: $enabled)
// VoiceOver: "Notifications, switch button, on/off"
```

### Custom Control
```swift
CustomRating(value: 4)
    .accessibilityLabel("Rating")
    .accessibilityValue("4 out of 5 stars")
    .accessibilityAddTraits(.isAdjustable)
    .accessibilityAdjustableAction { direction in
        // handle increment/decrement
    }
```

### Image
```swift
Image("hero")
    .accessibilityLabel("Mountain landscape at sunset")
// Decorative:
Image("divider")
    .accessibilityHidden(true)
```
