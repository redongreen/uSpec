# TalkBack (Android/Jetpack Compose) Properties Reference

## Core Modifiers

| Modifier | Use When |
|----------|----------|
| `contentDescription = "text"` | Set spoken label |
| `stateDescription = "text"` | Set current state |
| `semantics { }` | Group semantic properties |
| `clearAndSetSemantics { }` | Replace all child semantics |
| `invisibleToUser()` | Hide from TalkBack |

---

## Semantics Block

```kotlin
Modifier.semantics {
    contentDescription = "Submit form"
    stateDescription = "Enabled"
    role = Role.Button
}
```

---

## Roles

| Role | Use When |
|------|----------|
| `Role.Button` | Tappable action |
| `Role.Checkbox` | On/off selection |
| `Role.RadioButton` | One-of-many selection |
| `Role.Switch` | Toggle setting |
| `Role.Tab` | Tab control |
| `Role.Image` | Image content |
| `Role.DropdownList` | Dropdown menu |

```kotlin
Modifier.semantics { role = Role.Button }
```

---

## States

| Property | Use When |
|----------|----------|
| `selected = true/false` | Item is selected |
| `disabled()` | Not interactive |
| `focused = true/false` | Has focus |
| `heading()` | Section heading |
| `password()` | Password field |
| `error("message")` | Invalid/error state |
| `isEditable = true/false` | Editable text field |

---

## Dialogs & Popups

```kotlin
Modifier.semantics {
    isDialog = true  // Marks as dialog
    paneTitle = "Confirmation"  // Announced when pane appears
}

// For popups
Modifier.semantics {
    isPopup = true
}
```

```kotlin
Modifier.semantics {
    selected = true
    stateDescription = "Selected"
}
```

---

## Toggleable Elements

```kotlin
Modifier.semantics {
    role = Role.Checkbox
    toggleableState = ToggleableState.On // On, Off, Indeterminate
}

// Or use triStateToggleable
Modifier.triStateToggleable(
    state = ToggleableState.On,
    onClick = { },
    role = Role.Checkbox
)
```

---

## Actions

| Property | Use When |
|----------|----------|
| `onClick { }` | Tap action |
| `onLongClick { }` | Long press action |
| `customActions` | Additional actions |

### Custom Actions
```kotlin
Modifier.semantics {
    customActions = listOf(
        CustomAccessibilityAction("Delete") { deleteItem(); true },
        CustomAccessibilityAction("Share") { shareItem(); true }
    )
}
```

---

## Adjustable Values

For sliders, progress:

```kotlin
Modifier.semantics {
    progressBarRangeInfo = ProgressBarRangeInfo(
        current = 0.5f,
        range = 0f..1f
    )
    setProgress { newValue ->
        updateProgress(newValue)
        true
    }
}
```

---

## Scroll Actions

```kotlin
Modifier.semantics {
    horizontalScrollAxisRange = ScrollAxisRange(
        value = { scrollState.value.toFloat() },
        maxValue = { scrollState.maxValue.toFloat() }
    )
    verticalScrollAxisRange = ScrollAxisRange(
        value = { scrollState.value.toFloat() },
        maxValue = { scrollState.maxValue.toFloat() }
    )
    scrollBy { x, y ->
        coroutineScope.launch { scrollState.scrollBy(y) }
        true
    }
    scrollToIndex { index ->
        coroutineScope.launch { lazyListState.scrollToItem(index) }
        true
    }
}
```

---

## Expandable Content

```kotlin
Modifier.semantics {
    expand {
        expanded = true
        true
    }
    collapse {
        expanded = false
        true
    }
    dismiss {
        onDismiss()
        true
    }
}
```

---

## Page Navigation Actions

For large scrollable content (e.g., documents, readers):

```kotlin
Modifier.semantics {
    pageUp {
        scrollToPreviousPage()
        true
    }
    pageDown {
        scrollToNextPage()
        true
    }
    pageLeft {
        scrollToLeftPage()
        true
    }
    pageRight {
        scrollToRightPage()
        true
    }
}
```

---

## Grouping

### Merge Children
```kotlin
Row(
    modifier = Modifier.semantics(mergeDescendants = true) { }
) {
    Icon(Icons.Default.Star, contentDescription = null)
    Text("Favorites")
}
// TalkBack: "Favorites"
```

### Clear and Replace
```kotlin
Box(
    modifier = Modifier.clearAndSetSemantics {
        contentDescription = "5 stars, excellent rating"
    }
) {
    // Children ignored
}
```

### Traversal Group
```kotlin
// Group elements for navigation (replaces deprecated isContainer)
Row(
    modifier = Modifier.semantics { isTraversalGroup = true }
) {
    // Children navigated as a group
}
```

### Selectable Group
```kotlin
// For radio button groups
Column(
    modifier = Modifier.selectableGroup()
) {
    options.forEach { option ->
        Row(
            modifier = Modifier.selectable(
                selected = selectedOption == option,
                onClick = { selectedOption = option },
                role = Role.RadioButton
            )
        ) {
            RadioButton(selected = selectedOption == option, onClick = null)
            Text(option)
        }
    }
}
```

---

## Focus Management

```kotlin
val focusRequester = remember { FocusRequester() }

Text(
    "Error",
    modifier = Modifier.focusRequester(focusRequester)
)

// Request focus
LaunchedEffect(showError) {
    if (showError) focusRequester.requestFocus()
}
```

---

## Live Regions

```kotlin
Modifier.semantics {
    liveRegion = LiveRegionMode.Polite // or Assertive
}
```

| Mode | Use When |
|------|----------|
| `Polite` | Non-urgent updates |
| `Assertive` | Urgent updates, interrupts |

---

## Traversal Order

```kotlin
Modifier.semantics {
    traversalIndex = 1f // Lower = earlier
}
```

---

## Collections

### List/Grid Info
```kotlin
LazyColumn(
    modifier = Modifier.semantics {
        collectionInfo = CollectionInfo(
            rowCount = items.size,
            columnCount = 1
        )
    }
) {
    itemsIndexed(items) { index, item ->
        ListItem(
            modifier = Modifier.semantics {
                collectionItemInfo = CollectionItemInfo(
                    rowIndex = index,
                    rowSpan = 1,
                    columnIndex = 0,
                    columnSpan = 1
                )
            }
        )
    }
}
```

---

## Text Properties

| Property | Use When |
|----------|----------|
| `text = AnnotatedString("...")` | Set text content |
| `editableText = AnnotatedString("...")` | Editable text |
| `textSelectionRange = TextRange(...)` | Selection range |
| `imeAction = ImeAction.Search` | Keyboard action |
| `maxTextLength = 100` | Maximum allowed text length |

### Text Input Actions
```kotlin
Modifier.semantics {
    setText { text ->
        updateText(text.text)
        true
    }
    setSelection { start, end, relativeToOriginal ->
        setTextSelection(start, end)
        true
    }
    insertTextAtCursor { text ->
        insertAtCursor(text.text)
        true
    }
    copyText { true }
    cutText { true }
    pasteText { true }
}
```

---

## Announcements

```kotlin
val context = LocalContext.current
val view = LocalView.current

view.announceForAccessibility("Item deleted")
```

---

## Announcement Order

TalkBack announces:
1. Content description (or text)
2. Role
3. State description
4. Disabled status
5. Custom actions hint

---

## Best Practices

### Content Description
- Be concise (1-5 words)
- Don't include type (TalkBack adds role)
- Don't include state (use stateDescription)

### Grouping
- Use `mergeDescendants = true` for related elements
- Provide single description for complex groups

### Touch Targets
- Minimum 48dp × 48dp

---

## Common Patterns

### Button
```kotlin
Button(onClick = { }) {
    Text("Submit")
}
// TalkBack: "Submit, button, double-tap to activate"
```

### Checkbox
```kotlin
Row(
    modifier = Modifier
        .toggleable(
            value = checked,
            onValueChange = { checked = it },
            role = Role.Checkbox
        )
        .semantics { contentDescription = "Enable notifications" }
) {
    Checkbox(checked = checked, onCheckedChange = null)
    Text("Enable notifications")
}
// TalkBack: "Enable notifications, checkbox, checked/not checked"
```

### Switch
```kotlin
Switch(
    checked = enabled,
    onCheckedChange = { enabled = it },
    modifier = Modifier.semantics {
        contentDescription = "Dark mode"
    }
)
// TalkBack: "Dark mode, switch, on/off"
```

### Image
```kotlin
// Meaningful
Image(
    painter = painterResource(R.drawable.hero),
    contentDescription = "Mountain landscape at sunset"
)

// Decorative
Image(
    painter = painterResource(R.drawable.divider),
    contentDescription = null
)
```

### Custom Rating
```kotlin
RatingBar(
    value = 4,
    modifier = Modifier.semantics {
        contentDescription = "Rating"
        stateDescription = "4 out of 5 stars"
        role = Role.Image
    }
)
```
