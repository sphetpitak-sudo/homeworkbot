/**
 * Input validation utilities for API endpoints
 */

export function validateHomeworkInput(data: any): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "Request body is required" }
  }

  const { title, subject, due, priority, note, tags } = data

  // Title is required
  if (!title || typeof title !== "string" || !title.trim()) {
    return { valid: false, error: "Title is required and must be a non-empty string" }
  }

  if (title.length > 500) {
    return { valid: false, error: "Title must be less than 500 characters" }
  }

  // Subject validation
  if (subject !== undefined && subject !== null) {
    if (typeof subject !== "string") {
      return { valid: false, error: "Subject must be a string" }
    }
    if (subject.length > 100) {
      return { valid: false, error: "Subject must be less than 100 characters" }
    }
  }

  // Due date validation
  if (due !== undefined && due !== null) {
    if (typeof due !== "string") {
      return { valid: false, error: "Due date must be a string in YYYY-MM-DD format" }
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(due)) {
      return { valid: false, error: "Due date must be in YYYY-MM-DD format" }
    }
    const date = new Date(due)
    if (isNaN(date.getTime())) {
      return { valid: false, error: "Due date is invalid" }
    }
  }

  // Priority validation
  if (priority !== undefined && priority !== null) {
    if (typeof priority !== "string") {
      return { valid: false, error: "Priority must be a string" }
    }
    const validPriorities = ["🔴 High", "🟡 Medium", "🟢 Low", "🔴 สูง", "🟡 กลาง", "🟢 ต่ำ"]
    if (!validPriorities.includes(priority)) {
      return { valid: false, error: "Priority must be one of: 🔴 High, 🟡 Medium, 🟢 Low" }
    }
  }

  // Note validation
  if (note !== undefined && note !== null) {
    if (typeof note !== "string") {
      return { valid: false, error: "Note must be a string" }
    }
    if (note.length > 2000) {
      return { valid: false, error: "Note must be less than 2000 characters" }
    }
  }

  // Tags validation
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return { valid: false, error: "Tags must be an array" }
    }
    if (tags.length > 20) {
      return { valid: false, error: "Maximum 20 tags allowed" }
    }
    for (const tag of tags) {
      if (typeof tag !== "string") {
        return { valid: false, error: "Each tag must be a string" }
      }
      if (tag.length > 50) {
        return { valid: false, error: "Each tag must be less than 50 characters" }
      }
    }
  }

  return { valid: true }
}

export function validateStatusUpdate(data: any): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "Request body is required" }
  }

  const { id, status } = data

  if (!id || typeof id !== "string") {
    return { valid: false, error: "ID is required and must be a string" }
  }

  if (!status || typeof status !== "string") {
    return { valid: false, error: "Status is required and must be a string" }
  }

  const validStatuses = ["Todo", "In Progress", "Done"]
  if (!validStatuses.includes(status)) {
    return { valid: false, error: "Status must be one of: Todo, In Progress, Done" }
  }

  return { valid: true }
}

export function validateBulkStatusUpdate(data: any): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "Request body is required" }
  }

  const { ids, status } = data

  if (!ids || !Array.isArray(ids)) {
    return { valid: false, error: "IDs must be an array" }
  }

  if (ids.length === 0) {
    return { valid: false, error: "At least one ID is required" }
  }

  if (ids.length > 100) {
    return { valid: false, error: "Maximum 100 IDs allowed per bulk update" }
  }

  for (const id of ids) {
    if (!id || typeof id !== "string") {
      return { valid: false, error: "All IDs must be strings" }
    }
  }

  if (!status || typeof status !== "string") {
    return { valid: false, error: "Status is required and must be a string" }
  }

  const validStatuses = ["Todo", "In Progress", "Done"]
  if (!validStatuses.includes(status)) {
    return { valid: false, error: "Status must be one of: Todo, In Progress, Done" }
  }

  return { valid: true }
}

export function validateHomeworkUpdate(data: any): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "Request body is required" }
  }

  const { id, title, subject, due, priority, note, tags } = data

  if (!id || typeof id !== "string") {
    return { valid: false, error: "ID is required and must be a string" }
  }

  // Only validate fields that are actually present in the update
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return { valid: false, error: "Title must be a non-empty string" }
    }
    if (title.length > 500) {
      return { valid: false, error: "Title must be less than 500 characters" }
    }
  }

  if (subject !== undefined) {
    if (typeof subject !== "string") {
      return { valid: false, error: "Subject must be a string" }
    }
    if (subject.length > 100) {
      return { valid: false, error: "Subject must be less than 100 characters" }
    }
  }

  if (due !== undefined && due !== null) {
    if (typeof due !== "string") {
      return { valid: false, error: "Due date must be a string in YYYY-MM-DD format" }
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(due)) {
      return { valid: false, error: "Due date must be in YYYY-MM-DD format" }
    }
    const date = new Date(due)
    if (isNaN(date.getTime())) {
      return { valid: false, error: "Due date is invalid" }
    }
  }

  if (priority !== undefined && priority !== null) {
    if (typeof priority !== "string") {
      return { valid: false, error: "Priority must be a string" }
    }
    const validPriorities = ["🔴 High", "🟡 Medium", "🟢 Low", "🔴 สูง", "🟡 กลาง", "🟢 ต่ำ"]
    if (!validPriorities.includes(priority)) {
      return { valid: false, error: "Priority must be one of: 🔴 High, 🟡 Medium, 🟢 Low" }
    }
  }

  if (note !== undefined && note !== null) {
    if (typeof note !== "string") {
      return { valid: false, error: "Note must be a string" }
    }
    if (note.length > 2000) {
      return { valid: false, error: "Note must be less than 2000 characters" }
    }
  }

  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return { valid: false, error: "Tags must be an array" }
    }
    if (tags.length > 20) {
      return { valid: false, error: "Maximum 20 tags allowed" }
    }
    for (const tag of tags) {
      if (typeof tag !== "string") {
        return { valid: false, error: "Each tag must be a string" }
      }
      if (tag.length > 50) {
        return { valid: false, error: "Each tag must be less than 50 characters" }
      }
    }
  }

  return { valid: true }
}

export function validateDeleteRequest(data: any): { valid: boolean; error?: string } {
  if (!data) {
    return { valid: false, error: "Request body is required" }
  }

  const { id } = data

  if (!id || typeof id !== "string") {
    return { valid: false, error: "ID is required and must be a string" }
  }

  return { valid: true }
}
