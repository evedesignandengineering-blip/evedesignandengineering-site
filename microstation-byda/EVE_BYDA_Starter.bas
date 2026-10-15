Attribute VB_Name = "EVE_BYDA_Starter"
Option Explicit

' EVE BYDA Helper - free manual-submission starter for MicroStation CONNECT Edition.
' Select a closed Shape element in the active model before running PrepareBYDARequest.
' This macro prepares an audit CSV and opens the official BYDA website; it does NOT submit.
'
' Because MicroStation VBA object-model details vary across CONNECT updates/workspaces,
' the selected-shape vertex extraction is intentionally isolated for easy validation.
' Test on a copy of a drawing before operational use.

Public Sub PrepareBYDARequest()
    On Error GoTo Failed

    Dim jobName As String
    Dim jobRef As String
    Dim workDescription As String
    Dim zone As String
    Dim outputPath As String
    Dim fileNo As Integer
    Dim modelName As String
    Dim dgnPath As String
    Dim boundaryElement As Element
    Dim vertices As String
    Dim answer As VbMsgBoxResult

    jobName = Trim$(InputBox("Enter project / work-site name:", "EVE BYDA Helper"))
    If Len(jobName) = 0 Then
        MsgBox "Cancelled: project name is required.", vbInformation, "EVE BYDA Helper"
        Exit Sub
    End If

    jobRef = Trim$(InputBox("Enter your internal project reference (optional):", "EVE BYDA Helper"))
    workDescription = Trim$(InputBox("Describe the proposed work (for your records):", "EVE BYDA Helper", "Electrical / utility works"))
    zone = Trim$(InputBox("Enter the verified MGA94 zone (50, 51, 52, 53, 54, 55 or 56). Do not guess:", "EVE BYDA Helper"))
    If Len(zone) = 0 Then
        MsgBox "Cancelled: confirm the MGA94 zone before preparing the request.", vbExclamation, "EVE BYDA Helper"
        Exit Sub
    End If
    If Not IsNumeric(zone) Or Val(zone) < 50 Or Val(zone) > 56 Then
        MsgBox "Enter a valid MGA94 zone from 50 to 56.", vbExclamation, "EVE BYDA Helper"
        Exit Sub
    End If

    answer = MsgBox("Before continuing, select ONE closed Shape element that outlines the work area in the active model. Continue?", vbOKCancel + vbInformation, "EVE BYDA Helper")
    If answer <> vbOK Then Exit Sub

    Set boundaryElement = GetSelectedBoundaryElement()
    If boundaryElement Is Nothing Then
        MsgBox "No suitable selected boundary was found. Select one closed Shape element and run the macro again.", vbExclamation, "EVE BYDA Helper"
        Exit Sub
    End If

    vertices = GetBoundaryCoordinates(boundaryElement)
    If Len(vertices) = 0 Then
        MsgBox "Could not read boundary vertices from the selected element. No request file was written.", vbExclamation, "EVE BYDA Helper"
        Exit Sub
    End If

    modelName = ActiveModelReference.Name
    dgnPath = ActiveDesignFile.FullName
    outputPath = Environ$("USERPROFILE") & "DocumentsEVE_BYDA_Prepared_" & Format$(Now, "yyyymmdd_hhnnss") & ".csv"

    fileNo = FreeFile
    Open outputPath For Output As #fileNo
    Print #fileNo, "Field,Value"
    Print #fileNo, CsvLine("Project name", jobName)
    Print #fileNo, CsvLine("Internal project reference", jobRef)
    Print #fileNo, CsvLine("Work description", workDescription)
    Print #fileNo, CsvLine("Prepared at (local)", Format$(Now, "yyyy-mm-dd hh:nn:ss"))
    Print #fileNo, CsvLine("Drawing file", dgnPath)
    Print #fileNo, CsvLine("Model", modelName)
    Print #fileNo, CsvLine("Coordinate system", "GDA94 / MGA Zone " & zone & " (verify correct zone)")
    Print #fileNo, CsvLine("Boundary coordinates", vertices)
    Print #fileNo, CsvLine("Submission status", "PREPARED ONLY - not submitted")
    Close #fileNo

    ' Append a simple audit row. After lodging the enquiry, edit this CSV row to add
    ' the official BYDA reference and change status to SUBMITTED / RESPONSES RECEIVED.
    Dim logPath As String
    Dim logNo As Integer
    logPath = Environ$("USERPROFILE") & "\Documents\EVE_BYDA_Request_Log.csv"
    logNo = FreeFile
    If Dir$(logPath) = "" Then
        Open logPath For Output As #logNo
        Print #logNo, "PreparedAt,ProjectName,InternalReference,DrawingFile,Model,MGA94Zone,PreparedFile,BYDAReference,Status,Notes"
    Else
        Open logPath For Append As #logNo
    End If
    Print #logNo, """" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & """,""" & Replace(jobName, """", """""") & """,""" & Replace(jobRef, """", """""") & """,""" & Replace(dgnPath, """", """""") & """,""" & Replace(modelName, """", """""") & """,""" & zone & """,""" & Replace(outputPath, """", """""") & ""","",""PREPARED - NOT SUBMITTED"",""Update this row after manual submission""
    Close #logNo

    ThisApplication.StartDefaultBrowser "https://www.byda.com.au/"

    MsgBox "BYDA preparation file saved:" & vbCrLf & outputPath & vbCrLf & vbCrLf & _
           "The official BYDA website has been opened. Check the site location and draw/confirm the boundary in BYDA, complete the form and submit manually." & vbCrLf & _
           "This file is NOT proof of submission.", vbInformation, "EVE BYDA Helper"
    Exit Sub

Failed:
    On Error Resume Next
    If fileNo <> 0 Then Close #fileNo
    MsgBox "EVE BYDA Helper could not complete this step: " & Err.Description & vbCrLf & _
           "No automatic BYDA submission was made.", vbExclamation, "EVE BYDA Helper"
End Sub

Private Function GetSelectedBoundaryElement() As Element
    On Error GoTo NotFound
    Dim ee As ElementEnumerator
    Dim el As Element
    Dim found As Element
    Dim count As Long

    Set ee = ActiveModelReference.GetSelectedElements
    count = 0
    Do While ee.MoveNext
        Set el = ee.Current
        If el.Type = msdElementTypeShape Then
            count = count + 1
            Set found = el
        End If
    Loop

    If count = 1 Then Set GetSelectedBoundaryElement = found
    Exit Function
NotFound:
    Set GetSelectedBoundaryElement = Nothing
End Function

Private Function GetBoundaryCoordinates(ByVal el As Element) As String
    On Error GoTo CouldNotRead
    Dim vertexList As VertexList
    Dim pts() As Point2d
    Dim i As Long
    Dim result As String

    Set vertexList = el.AsVertexList
    pts = vertexList.GetVertices
    For i = LBound(pts) To UBound(pts)
        If Len(result) > 0 Then result = result & " | "
        result = result & Format$(pts(i).X, "0.000") & " " & Format$(pts(i).Y, "0.000")
    Next i
    GetBoundaryCoordinates = result
    Exit Function
CouldNotRead:
    GetBoundaryCoordinates = vbNullString
End Function

Private Function CsvLine(ByVal fieldName As String, ByVal fieldValue As String) As String
    CsvLine = """" & Replace(fieldName, """", """""") & """,""" & Replace(fieldValue, """", """""") & """"
End Function
